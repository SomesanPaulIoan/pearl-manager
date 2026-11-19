import { recordAlerts } from './rig-alerts.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const HISTORY_HOURS = 24 * 32;
const REPORT_HOURS = 24 * 400;
const PPS_SCALE = 2 ** 64 * 1e8;

const decimal = value => typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;

export function ppsProduction(window) {
  const immature = decimal(window?.immature_q64);
  const matured = decimal(window?.matured_q64);
  if (immature === null || matured === null) return null;
  const prl = Number(immature + matured) / PPS_SCALE;
  return Number.isFinite(prl) ? prl : null;
}

export function fleetPower(fleet) {
  const rigs = fleet?.rigs ?? [];
  const samples = rigs.flatMap(rig => rig.state === 'online' ? rig.gpus : []);
  const measured = samples.filter(gpu => Number.isFinite(gpu.powerW) && gpu.powerW >= 0);
  const complete = rigs.length > 0 && rigs.every(rig => rig.state === 'online' && rig.gpus.length > 0) &&
    measured.length === samples.length;
  return { complete, meteredGpus: measured.length,
    gpuWatts: measured.length ? measured.reduce((total, gpu) => total + gpu.powerW, 0) : null };
}

export function historyTotals(history, hours, now) {
  const end = Math.floor(now / HOUR_MS);
  let coveredHours = 0;
  let meteredMinutes = 0;
  let prl = 0;
  let gpuKwh = 0;
  for (let hour = end - hours; hour < end; hour++) {
    const bucket = history?.hours?.[hour];
    if (Number.isFinite(bucket?.prl)) {
      coveredHours++;
      prl += bucket.prl;
    }
    if (bucket?.minutes) {
      const watts = Object.values(bucket.minutes);
      meteredMinutes += watts.length;
      gpuKwh += watts.reduce((total, value) => total + value, 0) / 60_000;
    }
  }
  return {
    coveredHours, meteredMinutes, prl: coveredHours === hours ? prl : null,
    gpuKwh: meteredMinutes === hours * 60 ? gpuKwh : null,
  };
}

function poolHours(summary, now) {
  const currentHour = Math.floor(now / HOUR_MS);
  const pps = summary?.pps_income;
  if (Number.isFinite(pps?.read_at_ms) && Math.abs(now - pps.read_at_ms) <= 15 * MINUTE_MS &&
      Array.isArray(pps.hourly) && Array.isArray(summary.series)) {
    const income = new Map(pps.hourly.map(row => [row.hour, ppsProduction(row)]));
    const fullHours = summary.series.filter(row => row.hour % 3600 === 0 && row.hour / 3600 < currentHour &&
      row.share_statistics?.complete === true && row.share_statistics.observed_ms === HOUR_MS &&
      row.share_statistics.from === row.hour && row.share_statistics.to === row.hour + 3600 &&
      row.share_statistics.to * 1000 <= pps.read_at_ms);
    return { pps, income, fullHours };
  }
  return null;
}

function rewardForHour(row, income) {
  const amount = income.get(row.hour);
  const noShares = row.share_statistics.accepted_count === '0' && row.share_statistics.credited_work_count === '0' &&
    row.share_statistics.dropped_events === '0';
  return amount ?? (!income.has(row.hour) && noShares ? 0 : null);
}

export function recordPearlRewards(history, summary, now = Date.now()) {
  const pool = poolHours(summary, now);
  if (!pool) return;
  const rewards = history.pearlRewards ??= { closed: {} };
  const incomplete = rewards.incomplete ??= {};
  const currentHour = Math.floor(now / HOUR_MS);
  for (const row of pool.fullHours) {
    const hour = row.hour / 3600;
    const prl = rewardForHour(row, pool.income);
    if (prl !== null && hour >= currentHour - REPORT_HOURS) {
      rewards.closed[hour] = prl;
      delete incomplete[hour];
    }
  }
  for (const row of summary.series) {
    const hour = row.hour / 3600;
    const stats = row.share_statistics;
    const prl = pool.income.get(row.hour);
    if (Number.isInteger(hour) && hour < currentHour && hour >= currentHour - REPORT_HOURS &&
        rewards.closed[hour] === undefined && prl != null && stats?.observed_ms > 0 &&
        stats.from === row.hour && stats.to * 1000 <= pool.pps.read_at_ms) {
      incomplete[hour] = prl;
    }
  }
  const partial = summary.series.find(row => row.hour === currentHour * 3600 &&
    row.share_statistics?.complete === true && row.share_statistics.observed_ms > 0 &&
    row.share_statistics.from === row.hour && row.share_statistics.to * 1000 <= pool.pps.read_at_ms);
  const amount = partial ? rewardForHour(partial, pool.income) : null;
  if (amount !== null && (!rewards.partial || rewards.partial.at <= pool.pps.read_at_ms)) {
    rewards.partial = { hour: currentHour, prl: amount, at: pool.pps.read_at_ms };
  }
  for (const values of [rewards.closed, incomplete]) {
    for (const hour of Object.keys(values)) {
      if (Number(hour) < currentHour - REPORT_HOURS) delete values[hour];
    }
  }
  rewards.updatedAt = Math.max(rewards.updatedAt ?? 0, pool.pps.read_at_ms);
}

export function dailyPearlRewards(history, days, now = Date.now(), ledger) {
  const rewards = history?.pearlRewards;
  const closed = {...Object.fromEntries(Object.entries(history?.hours ?? {}).filter(([, bucket]) => Number.isFinite(bucket.prl)).map(([hour, bucket]) => [hour, bucket.prl])), ...rewards?.closed};
  const today = Math.floor(now / (24 * HOUR_MS));
  const firstHour = Math.min(...Object.keys(closed).map(Number), ...Object.keys(rewards?.incomplete ?? {}).map(Number), rewards?.partial?.hour ?? Infinity);
  const credited = ledger?.days ?? {};
  const firstLedgerDay = Math.min(...Object.keys(credited).map(day => Date.parse(day + 'T00:00:00Z') / (24 * HOUR_MS)));
  const first = Math.max(today - days + 1, Math.min(Math.floor(firstHour / 24), firstLedgerDay));
  const points = [];
  let cumulativePrl = 0;
  for (let day = first; day <= today; day++) {
    const date = new Date(day * 24 * HOUR_MS).toISOString().slice(0, 10);
    const ledgerDay = credited[date];
    if (ledgerDay) {
      cumulativePrl += ledgerDay.prl;
      points.push({ date, ...ledgerDay, coveredHours: 24, partialHours: 0,
        complete: true, source: 'ledger', cumulativePrl });
      continue;
    }
    let prl = 0;
    let coveredHours = 0;
    let partialHours = 0;
    for (let hour = day * 24; hour < (day + 1) * 24; hour++) {
      if (Number.isFinite(closed[hour])) {
        coveredHours++;
        prl += closed[hour];
      } else if (Number.isFinite(rewards?.incomplete?.[hour])) {
        partialHours++;
        prl += rewards.incomplete[hour];
      }
    }
    const partial = rewards?.partial;
    const hasPartial = day === today && partial?.hour === Math.floor(now / HOUR_MS);
    if (hasPartial && closed[partial.hour] === undefined && rewards.incomplete?.[partial.hour] === undefined) {
      partialHours++;
      prl += partial.prl;
    }
    cumulativePrl += prl;
    points.push({
      date,
      prl: coveredHours || partialHours ? prl : null, coveredHours, partialHours,
      complete: coveredHours === 24 && day < today, cumulativePrl,
    });
  }
  return { points, cumulativePrl, ledgerSalesUsd: ledger?.salesUsd ?? null, timezone: 'UTC',
    updatedAt: rewards?.updatedAt ? new Date(rewards.updatedAt).toISOString() : null };
}

export function recordHistory(history, summary, fleet, now = Date.now(), vast = {}) {
  const currentHour = Math.floor(now / HOUR_MS);
  const pool = poolHours(summary, now);
  if (pool) {
    const { income, fullHours } = pool;
    if (!Number.isInteger(history.startedHour)) {
      // Anchor to the current mining run, excluding older production before the last inactive hour.
      const ordered = [...summary.series].sort((a, b) => b.hour - a.hour);
      let earliest;
      const latest = ordered.find(row => (income.get(row.hour) ?? 0) > 0);
      for (const row of ordered) {
        if (!latest || row.hour > latest.hour) continue;
        if ((income.get(row.hour) ?? 0) <= 0 || (earliest !== undefined && row.hour !== earliest - 3600)) break;
        earliest = row.hour;
      }
      if (earliest !== undefined) history.startedHour = earliest / 3600;
    }
    for (const row of fullHours) {
      const hour = row.hour / 3600;
      if (!Number.isInteger(history.startedHour) || hour < history.startedHour || hour < currentHour - HISTORY_HOURS) continue;
      const prl = rewardForHour(row, income);
      if (prl !== null) {
        const bucket = history.hours[hour] ??= {};
        bucket.prl = prl;
      }
    }
  }

  const { complete, gpuWatts } = fleetPower(fleet);
  if (complete) {
    const bucket = history.hours[currentHour] ??= {};
    const minutes = bucket.minutes ??= {};
    minutes[Math.floor(now / MINUTE_MS) % 60] = gpuWatts;
  }
  for (const rig of fleet?.rigs ?? []) {
    if (rig.state !== 'online' || !rig.gpus.length) continue;
    const { complete: powerComplete, gpuWatts: watts } = fleetPower({ rigs: [rig] });
    const knownMining = rig.gpus.every(gpu => gpu.mining !== 'unknown');
    const mining = rig.gpus.some(gpu => ['container', 'process'].includes(gpu.mining));
    const rate = knownMining ? (mining ? rig.minerHashrateHs ?? null : 0) : null;
    if (!powerComplete && rate === null) continue;
    const bucket = history.hours[currentHour] ??= {};
    const rigs = bucket.rigs ??= {};
    const id = rig.financialRigId || rig.name;
    const readings = rigs[id] ??= {};
    const rental = vast[id];
    const activity = mining && rental === 'active' ? 'mixed'
      : mining ? 'pearl' : rental === 'active' ? 'vast'
      : knownMining && rental === 'idle' ? 'idle' : 'unknown';
    readings[Math.floor(now / MINUTE_MS) % 60] = [powerComplete ? watts : null, rate, activity, rig.name];
  }
  for (const [hour, bucket] of Object.entries(history.hours)) {
    if (Number(hour) < currentHour - REPORT_HOURS) delete history.hours[hour];
    else if (Number(hour) < currentHour - HISTORY_HOURS) {
      if (bucket.minutes) {
        const samples = Object.values(bucket.minutes);
        bucket.archivedPower = { count: samples.length, gpuKwh: samples.reduce((sum, watts) => sum + watts, 0) / 60_000 };
        delete bucket.minutes;
      }
      if (bucket.rigs) {
        bucket.archivedActivity = summarizeActivity(bucket.rigs);
        delete bucket.rigs;
      }
    }
  }
}

function summarizeActivity(rigs) {
  const result = {};
  for (const [id, minutes] of Object.entries(rigs ?? {})) {
    for (const [watts, , state, name] of Object.values(minutes)) {
      if (!state) continue;
      const rig = result[id] ??= { name, states: {} };
      const entry = rig.states[state] ??= { minutes: 0, metered: 0, gpuKwh: 0 };
      entry.minutes++;
      if (Number.isFinite(watts)) {
        entry.metered++;
        entry.gpuKwh += watts / 60_000;
      }
    }
  }
  return result;
}

export function monthlyMining(history, month, overhead, tariff, now = Date.now()) {
  const first = Date.parse(month + '-01T00:00:00Z');
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const begin = first / HOUR_MS;
  const end = Math.min(next.valueOf(), now) / HOUR_MS;
  let prl = 0;
  let coveredHours = 0;
  let partialHours = 0;
  let meteredMinutes = 0;
  let gpuKwh = 0;
  const activity = {};
  for (let hour = begin; hour < Math.floor(end); hour++) {
    const bucket = history?.hours?.[hour];
    for (const [id, report] of Object.entries(bucket?.archivedActivity ?? summarizeActivity(bucket?.rigs))) {
      const rig = activity[id] ??= { name: report.name, states: {} };
      for (const [state, data] of Object.entries(report.states)) {
        const current = rig.states[state] ??= { minutes: 0, metered: 0, costRon: 0 };
        current.minutes += data.minutes;
        current.metered += data.metered;
        current.costRon += data.gpuKwh * (1 + overhead) * tariff;
      }
    }
    const reward = history?.pearlRewards?.closed?.[hour] ?? bucket?.prl;
    if (Number.isFinite(reward)) {
      coveredHours++;
      prl += reward;
    } else if (Number.isFinite(history?.pearlRewards?.incomplete?.[hour])) {
      partialHours++;
      prl += history.pearlRewards.incomplete[hour];
    }
    if (bucket?.minutes) {
      const samples = Object.values(bucket.minutes);
      meteredMinutes += samples.length;
      gpuKwh += samples.reduce((sum, watts) => sum + watts, 0) / 60_000;
    } else if (bucket?.archivedPower) {
      meteredMinutes += bucket.archivedPower.count;
      gpuKwh += bucket.archivedPower.gpuKwh;
    }
  }
  const kwh = meteredMinutes ? gpuKwh * (1 + overhead) : null;
  return { month, hours: Math.max(0, Math.floor(end) - begin), coveredHours, meteredMinutes,
    prl: coveredHours || partialHours ? prl : null, kwh, activity, estimatedCostRon: kwh === null ? null : kwh * tariff };
}

export function createMiningHistory(directory, wallet, getSummary, getFleet, getVast = () => ({}), getRewardHistory) {
  const filename = new URL('mining-history.json', directory);
  let history;
  let pending;
  let lastArchiveAttempt = 0;
  async function collect() {
    if (!history) {
      try {
        const saved = JSON.parse(await readFile(filename, 'utf8'));
        history = saved.wallet === wallet && saved.hours ? saved : { wallet, hours: {} };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        history = { wallet, hours: {} };
      }
    }
    const [pool, fleet] = await Promise.allSettled([getSummary(), getFleet()]);
    const archive = getRewardHistory && (history.pearlRewards?.archiveVersion !== 2 || Date.now() - history.pearlRewards.backfilledAt >= 3_600_000);
    if (archive && Date.now() - lastArchiveAttempt >= 300_000) {
      lastArchiveAttempt = Date.now();
      try {
        const backfill = await getRewardHistory();
        if (backfill?.hours === 360) {
          recordPearlRewards(history, backfill);
          if (history.pearlRewards) {
            history.pearlRewards.backfilledAt = Date.now();
            history.pearlRewards.archiveVersion = 2;
          }
        }
      } catch {
        // Keep the live collector and previously observed rewards available.
      }
    }
    const now = Date.now();
    recordPearlRewards(history, pool.value, now);
    recordHistory(history, pool.value, fleet.value, now, getVast());
    recordAlerts(history, fleet.value, now);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = new URL('mining-history.json.tmp', directory);
    await writeFile(temp, JSON.stringify(history), { mode: 0o600 });
    await rename(temp, filename);
  }
  function refresh() {
    pending ??= collect().catch(error => {
      console.error('Mining history collection failed:', error.code ?? error.name);
    }).finally(() => { pending = undefined; });
    return pending;
  }
  return { refresh, read: () => history };
}
