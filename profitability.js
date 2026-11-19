import { fleetPower, historyTotals, ppsProduction } from './mining-history.js';

const PERIODS = [1, 24, 168, 720];

export function estimateProfitability({ pps, quote, fx, fleet, tariff, overhead, history, now = Date.now() }) {
  const ppsAt = pps?.read_at_ms;
  const ppsIsFresh = Number.isFinite(ppsAt) && Math.abs(now - ppsAt) <= 15 * 60_000;
  const hourPrl = ppsIsFresh ? ppsProduction(pps.by_window?.h1) : null;
  const priceUsd = quote?.quoteUpdatedAt && Math.abs(now - Date.parse(quote.quoteUpdatedAt)) <= 15 * 60_000
    ? quote.amount : null;
  const usdRon = fx?.rates?.RON > 0 && Number.isFinite(fx.rates.RON) ? fx.rates.RON : null;
  const rigCount = fleet?.rigs.length ?? 0;
  const { complete, gpuWatts, meteredGpus } = fleetPower(fleet);
  const wallKw = complete ? gpuWatts * (1 + overhead) / 1000 : null;

  const periods = PERIODS.map(hours => {
    const coverage = hours === 1 ? null : historyTotals(history, hours, now);
    const observed = coverage?.prl != null;
    const projected = hours > 1 && !observed;
    const prl = observed ? coverage.prl : hourPrl === null ? null : hourPrl * hours;
    const revenueUsd = prl === null || priceUsd === null ? null : prl * priceUsd;
    const revenueRon = revenueUsd === null || usdRon === null ? null : revenueUsd * usdRon;
    const energyKwh = observed
      ? coverage.gpuKwh === null ? null : coverage.gpuKwh * (1 + overhead)
      : wallKw === null ? null : wallKw * hours;
    const energyRon = energyKwh === null ? null : energyKwh * tariff;
    return {
      hours, projected, coveredHours: coverage?.coveredHours ?? null,
      meteredMinutes: coverage?.meteredMinutes ?? null, prl, revenueUsd, revenueRon, energyKwh, energyRon,
      profitRon: revenueRon === null || energyRon === null ? null : revenueRon - energyRon,
    };
  });
  return {
    periods, tariff, overhead, gpuWatts, wallKw, rigCount, meteredGpus,
    priceUsd, usdRon, fxDate: usdRon === null ? null : fx.date,
    productionAt: ppsIsFresh ? new Date(ppsAt).toISOString() : null,
  };
}
