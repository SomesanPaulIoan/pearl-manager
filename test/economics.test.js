import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateRigPeriods } from '../rig-economics.js';
import { recordAlerts, readAlerts } from '../rig-alerts.js';
import { dailyPearlRewards, monthlyMining, recordHistory, recordPearlRewards } from '../mining-history.js';

const hour = 3_600_000;
const now = Date.UTC(2026, 10, 19, 18);
const rig = (id, rate, powerW = 1000) => ({
  name: id, financialRigId: id, state: 'online', minerHashrateHs: rate,
  gpus: [{ mining: 'container', temperatureC: 75, powerW }],
});
const minutes = (rate, watts) => Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i, [watts, rate]]));
const args = { rigs: [rig('R1', 1), rig('R2', 3)], now, tariff: 1, overhead: 0, priceUsd: 2, usdRon: 5 };

test('hourly projection allocates by hashrate and preserves total production', () => {
  const result = estimateRigPeriods({ ...args, period: { hours: 24, projected: true, prl: 24 } });
  assert.deepEqual(result.map(row => row.prl), [6, 18]);
  assert.deepEqual(result.map(row => row.energyKwh), [24, 24]);
  assert.deepEqual(result.map(row => row.profitRon), [36, 156]);
});

test('historical rig attribution follows each hour, not the latest rate', () => {
  const bucket = now / hour;
  const history = { hours: {
    [bucket - 2]: { prl: 10, rigs: { R1: minutes(1, 1000), R2: minutes(3, 1000) } },
    [bucket - 1]: { prl: 10, rigs: { R1: minutes(3, 1000), R2: minutes(1, 1000) } },
  }};
  const period = { hours: 2, projected: false, prl: 20 };
  assert.deepEqual(estimateRigPeriods({ ...args, period, history }).map(row => row.prl), [10, 10]);
  delete history.hours[bucket - 1].rigs.R1[42];
  assert.deepEqual(estimateRigPeriods({ ...args, period, history }).map(row => row.prl), [null, null]);
});

test('alert emits one incident after three minutes and one recovery after two', () => {
  const history = { hours: {} };
  const fleet = { rigs: [rig('R1', 1)] };
  fleet.rigs[0].gpus[0].temperatureC = 82;
  for (let i = 0; i < 4; i++) recordAlerts(history, fleet, now + i * 60_000);
  assert.equal(readAlerts(history).events.length, 1);
  assert.equal(readAlerts(history).active[0].kind, 'temperature');
  fleet.rigs[0].gpus[0].temperatureC = 72;
  for (let i = 4; i < 6; i++) recordAlerts(history, fleet, now + i * 60_000);
  assert.equal(readAlerts(history).active.length, 0);
  assert.deepEqual(readAlerts(history).events.map(event => event.active), [false, true]);
});

test('monthly report counts observed minutes and keeps mixed activity distinct', () => {
  const history = { hours: {} };
  recordHistory(history, null, { rigs: args.rigs }, now - hour, { R1: 'active', R2: 'idle' });
  const result = monthlyMining(history, '2026-11', 0, 1, now);
  assert.equal(result.prl, null);
  assert.equal(result.meteredMinutes, 1);
  assert.equal(result.activity.R1.states.mixed.minutes, 1);
  assert.equal(result.activity.R2.states.pearl.minutes, 1);
});

test('PPS archive keeps verified zeroes, gaps and current-hour partial rewards distinct', () => {
  const history = { hours: {} };
  const n = Date.UTC(2026, 10, 19, 2, 30);
  const closed = Date.UTC(2026, 10, 17, 16) / 1000;
  const partial = Date.UTC(2026, 10, 19, 2) / 1000;
  const statistics = (start, observed, accepted) => ({
    from: start, to: start + observed / 1000, complete: true, observed_ms: observed,
    accepted_count: accepted, credited_work_count: accepted, dropped_events: '0',
  });
  const reward = (hour, prl) => ({
    hour, immature_q64: String(BigInt(prl) * 100000000n * 2n ** 64n), matured_q64: '0',
  });
  const series = [
    { hour: closed, share_statistics: statistics(closed, 3600000, '2') },
    { hour: closed + 3600, share_statistics: statistics(closed + 3600, 3600000, '0') },
    { hour: closed + 7200, share_statistics: { ...statistics(closed + 7200, 1800000, '1'), complete: false } },
    { hour: partial, share_statistics: statistics(partial, 1800000, '1') },
  ];
  recordPearlRewards(history, { series, pps_income: { read_at_ms: n, hourly: [reward(closed, 3), reward(closed + 7200, 2), reward(partial, 1)] } }, n);
  assert.equal(history.startedHour, undefined);
  const result = dailyPearlRewards(history, 7, n);
  assert.deepEqual(result.points.map(day => [day.prl, day.coveredHours, day.cumulativePrl]), [[5, 2, 5], [null, 0, 5], [1, 0, 6]]);
  assert.equal(result.cumulativePrl, 6);
  assert.equal(monthlyMining(history, '2026-11', 0, 1, n).prl, 5);
  assert.equal(dailyPearlRewards(history, 7, n + 3600000).points.at(-1).prl, null);
});

test('credited ledger days supersede chart estimates without discarding later live rewards', () => {
  const n = Date.UTC(2026, 10, 19, 2);
  const hour = n / 3600000;
  const result = dailyPearlRewards({hours: {[hour-1]: {prl: 1}, [hour-24]: {prl: 2}}},
    7, n, {salesUsd: 10, days: {'2026-11-18': {prl: 7, allocatedUsd: 10, averageUsd: 2}}});
  assert.deepEqual(result.points.map(day => day.prl), [7, 1]);
  assert.equal(result.points[0].source, 'ledger');
  assert.equal(result.points[0].allocatedUsd, 10);
  assert.equal(result.cumulativePrl, 8);
});
