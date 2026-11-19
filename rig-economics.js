import { fleetPower } from './mining-history.js';

const HOUR = 3_600_000;
const key = rig => rig.financialRigId || rig.name;

function liveRates(rigs) {
  return rigs.map(rig => {
    if (rig.state !== 'online' || !rig.gpus.length || rig.gpus.some(gpu => gpu.mining === 'unknown')) return null;
    const mining = rig.gpus.some(gpu => ['container', 'process'].includes(gpu.mining));
    return mining ? rig.minerHashrateHs ?? null : 0;
  });
}

function addShares(amounts, prl, rates) {
  if (prl === null || rates.some(rate => rate === null)) return false;
  const total = rates.reduce((sum, rate) => sum + rate, 0);
  if (!total && prl > 0) return false;
  rates.forEach((rate, index) => { amounts[index] += total ? prl * rate / total : 0; });
  return true;
}

export function estimateRigPeriods({ rigs, period, history, now, tariff, overhead, priceUsd, usdRon }) {
  const prl = rigs.map(() => 0);
  const gpuKwh = rigs.map(() => 0);
  const powerComplete = rigs.map(() => true);
  let productionComplete = true;
  const rates = liveRates(rigs);
  if (period.hours === 1 || period.projected) {
    productionComplete = addShares(prl, period.prl, rates);
    rigs.forEach((rig, index) => {
      const power = fleetPower({ rigs: [rig] });
      powerComplete[index] = power.complete;
      gpuKwh[index] = (power.gpuWatts ?? 0) * period.hours / 1000;
    });
  } else {
    const end = Math.floor(now / HOUR);
    for (let hour = end - period.hours; hour < end; hour++) {
      const bucket = history?.hours?.[hour];
      const historicalRates = rigs.map((rig, index) => {
        const minutes = Object.values(bucket?.rigs?.[key(rig)] ?? {});
        const watts = minutes.map(reading => reading[0]).filter(Number.isFinite);
        const hashrate = minutes.map(reading => reading[1]).filter(Number.isFinite);
        if (watts.length < 60) powerComplete[index] = false;
        gpuKwh[index] += watts.reduce((sum, value) => sum + value, 0) / 60_000;
        return hashrate.length === 60 ? hashrate.reduce((sum, value) => sum + value, 0) / 60 : null;
      });
      if (!addShares(prl, bucket?.prl ?? null, historicalRates)) productionComplete = false;
    }
  }

  return rigs.map((rig, index) => {
    const production = productionComplete ? prl[index] : null;
    const energyKwh = powerComplete[index] ? gpuKwh[index] * (1 + overhead) : null;
    const energyRon = energyKwh === null ? null : energyKwh * tariff;
    const revenueRon = production === null || priceUsd === null || usdRon === null ? null : production * priceUsd * usdRon;
    return {
      id: key(rig), name: rig.name, hashrateHs: rates[index], prl: production, energyKwh, energyRon, revenueRon,
      profitRon: revenueRon === null || energyRon === null ? null : revenueRon - energyRon,
      prlPerKwh: production === null || !energyKwh ? null : production / energyKwh,
      breakEvenUsd: !production || energyRon === null || usdRon === null ? null : energyRon / production / usdRon,
    };
  });
}
