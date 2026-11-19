import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const HISTORY_HOURS = 24 * 32;
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

export function recordHistory(history, summary, fleet, now = Date.now()) {
  const currentHour = Math.floor(now / HOUR_MS);
  const pps = summary?.pps_income;
  if (Number.isFinite(pps?.read_at_ms) && Math.abs(now - pps.read_at_ms) <= 15 * MINUTE_MS &&
      Array.isArray(pps.hourly) && Array.isArray(summary.series)) {
    const income = new Map(pps.hourly.map(row => [row.hour, ppsProduction(row)]));
    const fullHours = summary.series.filter(row => row.hour % 3600 === 0 && row.hour / 3600 < currentHour &&
      row.share_statistics?.complete === true && row.share_statistics.observed_ms === HOUR_MS &&
      row.share_statistics.from === row.hour && row.share_statistics.to === row.hour + 3600 &&
      row.share_statistics.to * 1000 <= pps.read_at_ms);
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
      const amount = income.get(row.hour);
      const zeroShares = row.share_statistics.accepted_count === '0' && row.share_statistics.credited_work_count === '0' &&
        row.share_statistics.dropped_events === '0';
      if (amount != null || (!income.has(row.hour) && zeroShares)) {
        const bucket = history.hours[hour] ??= {};
        bucket.prl = amount ?? 0;
      }
    }
  }

  const { complete, gpuWatts } = fleetPower(fleet);
  if (complete) {
    const bucket = history.hours[currentHour] ??= {};
    const minutes = bucket.minutes ??= {};
    minutes[Math.floor(now / MINUTE_MS) % 60] = gpuWatts;
  }
  for (const hour of Object.keys(history.hours)) {
    if (Number(hour) < currentHour - HISTORY_HOURS) delete history.hours[hour];
  }
}

export function createMiningHistory(directory, wallet, getSummary, getFleet) {
  const filename = new URL('mining-history.json', directory);
  let history;
  let pending;
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
    recordHistory(history, pool.value, fleet.value);
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
