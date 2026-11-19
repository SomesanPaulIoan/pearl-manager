const PPS_SCALE = 2 ** 64 * 1e8;
const PERIODS = [
  { hours: 1, window: 'h1' },
  { hours: 24, window: 'h24' },
  { hours: 168, projection: 7 },
  { hours: 720, projection: 30 },
];

const decimal = value => typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;

function production(window) {
  const immature = decimal(window?.immature_q64);
  const matured = decimal(window?.matured_q64);
  if (immature === null || matured === null) return null;
  const prl = Number(immature + matured) / PPS_SCALE;
  return Number.isFinite(prl) ? prl : null;
}

export function estimateProfitability({ pps, quote, fx, fleet, tariff, overhead }) {
  const ppsAt = pps?.read_at_ms;
  const ppsIsFresh = Number.isFinite(ppsAt) && Math.abs(Date.now() - ppsAt) <= 15 * 60_000;
  const dayPrl = ppsIsFresh ? production(pps.by_window?.h24) : null;
  const priceUsd = quote?.quoteUpdatedAt && Math.abs(Date.now() - Date.parse(quote.quoteUpdatedAt)) <= 15 * 60_000
    ? quote.amount : null;
  const usdRon = fx?.rates?.RON > 0 && Number.isFinite(fx.rates.RON) ? fx.rates.RON : null;
  const rigCount = fleet?.rigs.length ?? 0;
  const powerSamples = fleet?.rigs.flatMap(rig => rig.state === 'online' ? rig.gpus : []) ?? [];
  const measured = powerSamples.filter(gpu => Number.isFinite(gpu.powerW) && gpu.powerW >= 0);
  const hasCompletePower = rigCount > 0 && fleet.rigs.every(rig => rig.state === 'online') &&
    measured.length > 0 && measured.length === powerSamples.length;
  const gpuWatts = measured.length ? measured.reduce((sum, gpu) => sum + gpu.powerW, 0) : null;
  const wallKw = hasCompletePower ? gpuWatts * (1 + overhead) / 1000 : null;

  const periods = PERIODS.map(({ hours, window, projection }) => {
    const prl = projection
      ? dayPrl === null ? null : dayPrl * projection
      : ppsIsFresh ? production(pps.by_window?.[window]) : null;
    const revenueUsd = prl === null || priceUsd === null ? null : prl * priceUsd;
    const revenueRon = revenueUsd === null || usdRon === null ? null : revenueUsd * usdRon;
    const energyKwh = wallKw === null ? null : wallKw * hours;
    const energyRon = energyKwh === null ? null : energyKwh * tariff;
    return {
      hours, projected: Boolean(projection), prl, revenueUsd, revenueRon, energyKwh, energyRon,
      profitRon: revenueRon === null || energyRon === null ? null : revenueRon - energyRon,
    };
  });
  return {
    periods, tariff, overhead, gpuWatts, wallKw, rigCount, meteredGpus: measured.length,
    priceUsd, usdRon, fxDate: usdRon === null ? null : fx.date,
    productionAt: ppsIsFresh ? new Date(ppsAt).toISOString() : null,
  };
}
