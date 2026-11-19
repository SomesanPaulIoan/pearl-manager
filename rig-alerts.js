const MINUTE = 60_000;
const HOUR = 3_600_000;

function baseline(history, id, now) {
  const samples = [];
  for (let ago = 1; ago <= 60; ago++) {
    const time = now - ago * MINUTE;
    const value = history.hours[Math.floor(time / HOUR)]?.rigs?.[id]?.[Math.floor(time / MINUTE) % 60]?.[1];
    if (Number.isFinite(value) && value > 0) samples.push(value);
  }
  if (samples.length < 15) return null;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

export function recordAlerts(history, fleet, now) {
  if (!fleet?.rigs?.length) return;
  const alerts = history.alerts ??= { states: {}, events: [] };
  const minute = Math.floor(now / MINUTE);
  function update(id, kind, rig, message, condition) {
    if (condition === null) return;
    const key = id + ':' + kind;
    const item = alerts.states[key] ??= { count: 0, active: false };
    if (item.minute === minute) return;
    item.count = item.minute === minute - 1 && item.condition === condition ? item.count + 1 : 1;
    item.minute = minute;
    item.condition = condition;
    if (item.active !== condition && item.count >= (condition ? 3 : 2)) {
      item.active = condition;
      item.rig = rig;
      item.kind = kind;
      item.message = message;
      item.at = new Date(now).toISOString();
      alerts.events.unshift({ rig, kind, message, active: condition, at: item.at });
      alerts.events.length = Math.min(alerts.events.length, 200);
    }
  }

  for (const rig of fleet.rigs) {
    const id = rig.financialRigId || rig.name;
    const online = rig.state === 'online';
    const temperatures = rig.gpus.map(gpu => gpu.temperatureC).filter(Number.isFinite);
    const missingMiner = rig.gpus.filter(gpu => gpu.mining === 'not-detected');
    const known = rig.gpus.length > 0 && rig.gpus.every(gpu => gpu.mining !== 'unknown');
    const reference = baseline(history, id, now);
    update(id, 'offline', rig.name, 'Telemetrie rig indisponibilă', !online);
    update(id, 'temperature', rig.name, 'O placă a atins cel puțin 80 °C',
      online && temperatures.length ? temperatures.some(c => c >= 80) : null);
    update(id, 'mining', rig.name, 'Minerul Pearl lipsește de pe cel puțin un GPU',
      online && known ? missingMiner.length > 0 : null);
    update(id, 'hashrate', rig.name, 'Hashrate sub 75% din mediana recentă',
      online && reference && Number.isFinite(rig.minerHashrateHs) ? rig.minerHashrateHs < reference * .75 : null);
  }
}

export function readAlerts(history) {
  return {
    active: Object.values(history?.alerts?.states ?? {}).filter(alert => alert.active)
      .sort((a, b) => b.at.localeCompare(a.at)).map(({ rig, kind, message, at }) => ({ rig, kind, message, at })),
    events: history?.alerts?.events ?? [],
  };
}
