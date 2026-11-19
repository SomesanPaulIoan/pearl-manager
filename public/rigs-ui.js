const status = document.querySelector('#status');
const summary = document.querySelector('#summary');
const rigs = document.querySelector('#rigs');
const refresh = document.querySelector('#refresh');
const format = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'short', timeStyle: 'medium' });
const amount = (value, unit) => value === null ? '—' : `${format.format(value)} ${unit}`;
const formatHashrate = value => value >= 1e15 ? amount(value / 1e15, 'PH/s') : amount(value / 1e12, 'TH/s');
const miningLabel = {
  container: 'Pearl · container',
  process: 'Pearl · proces detectat',
  'not-detected': 'Pearl nedetectat',
  unknown: 'Necunoscut',
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderRig(rig, open) {
  const panel = element('details', '', 'rig');
  panel.open = open;
  panel.dataset.rig = rig.name;
  const title = element('summary', '', 'rig-summary');
  title.append(element('strong', rig.name));
  const maxTemp = rig.gpus.reduce((max, gpu) => gpu.temperatureC === null ? max : Math.max(max, gpu.temperatureC), -Infinity);
  const overview = [rig.gpus.length ? `${rig.gpus.length} GPU` : '',
    Number.isFinite(maxTemp) ? `${maxTemp} °C max.` : '',
    rig.state === 'online' ? 'Online' : rig.state === 'stale' ? 'Ultima citire' : 'Indisponibil'];
  title.append(element('span', overview.filter(Boolean).join(' · '), maxTemp >= 80 ? 'rig-meta warn' : 'rig-meta'));
  panel.append(title);
  const state = { online: 'Online', stale: 'Ultima citire disponibilă', unavailable: 'Telemetrie indisponibilă' };
  const timestamp = rig.sampledAt ? ` · ${time.format(new Date(rig.sampledAt))}` : '';
  panel.append(element('p', state[rig.state] + timestamp, rig.state === 'online' ? 'detail' : 'detail warn'));
  if (!rig.gpus.length) return panel;
  const reportedHashrate = rig.minerHashrateHs == null
    ? 'Indisponibil'
    : `${formatHashrate(rig.minerHashrateHs)} · raportat de miner`;
  panel.append(element('p', `Hashrate local · ${reportedHashrate}`, 'detail'));

  const scroll = element('div', '', 'table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', `Plăci video · ${rig.name}`);
  const table = element('table');
  const headings = table.createTHead().insertRow();
  const labels = ['GPU', 'Miner', 'Temperatură', 'Utilizare', 'VRAM', 'Putere / limită', 'Ventilator', 'PCIe'];
  for (const heading of labels) {
    const cell = element('th', heading);
    cell.scope = 'col';
    headings.append(cell);
  }
  const body = table.createTBody();
  for (const gpu of rig.gpus) {
    const row = body.insertRow();
    const values = [
      `#${gpu.index} · ${gpu.name.replace(/^NVIDIA GeForce /, '')}`, miningLabel[gpu.mining],
      amount(gpu.temperatureC, '°C'), amount(gpu.utilizationPct, '%'),
      `${amount(gpu.memoryUsedMiB, 'MiB')} / ${amount(gpu.memoryTotalMiB, 'MiB')}`,
      `${amount(gpu.powerW, 'W')} / ${amount(gpu.powerLimitW, 'W')}`,
      amount(gpu.fanPct, '%'), gpu.pcieGeneration && gpu.pcieLanes ? `Gen ${gpu.pcieGeneration} ×${gpu.pcieLanes}` : '—',
    ];
    values.forEach((value, index) => {
      const cell = row.insertCell();
      cell.dataset.label = labels[index];
      cell.textContent = value;
    });
    if (gpu.mining === 'container' || gpu.mining === 'process') row.cells[1].className = 'mining';
    if (gpu.temperatureC >= 80) row.cells[2].className = 'warn';
  }
  scroll.append(table);
  panel.append(scroll);
  return panel;
}

async function update() {
  if (refresh.disabled) return;
  refresh.disabled = true;
  try {
    const response = await fetch('/api/rigs', { cache: 'no-store', signal: AbortSignal.timeout(16_000) });
    if (!response.ok) throw new Error('Telemetry HTTP error');
    const data = await response.json();
    status.textContent = data.error || (data.enabled ? 'Citire automată la 30 s. Temperaturile de la 80 °C sunt evidențiate.' : 'Monitorizarea rigurilor nu este configurată.');
    const online = data.rigs.filter(rig => rig.state === 'online');
    const gpus = online.flatMap(rig => rig.gpus);
    const mining = gpus.filter(gpu => gpu.mining === 'container' || gpu.mining === 'process').length;
    const reported = online.map(rig => rig.minerHashrateHs).filter(value => value != null);
    const temperatures = gpus.map(gpu => gpu.temperatureC).filter(value => value !== null);
    const powers = gpus.map(gpu => gpu.powerW).filter(value => value !== null);
    const watts = powers.reduce((total, value) => total + value, 0);
    const metrics = data.rigs.length ? [
      [`${online.length} / ${data.rigs.length}`, 'Riguri online'],
      [String(gpus.length), 'GPU observate live'],
      [String(mining), 'GPU cu miner Pearl detectat'],
      [reported.length ? formatHashrate(reported.reduce((sum, value) => sum + value, 0)) : '—',
        `Hashrate local raportat · ${reported.length}/${data.rigs.length} riguri`],
      [amount(temperatures.length ? Math.max(...temperatures) : null, '°C'), 'Temperatură maximă'],
      [amount(powers.length ? watts / 1000 : null, 'kW'), `Putere GPU măsurată · ${powers.length}/${gpus.length} plăci`],
    ] : [];
    summary.replaceChildren(...metrics.map(([value, label]) => {
      const card = element('div', '', 'metric');
      card.append(element('strong', value), element('span', label, 'detail'));
      return card;
    }));
    const expanded = new Map([...rigs.querySelectorAll('.rig')].map(panel => [panel.dataset.rig, panel.open]));
    const currentFocus = document.activeElement.closest('.rig-summary')?.parentElement.dataset.rig;
    const compact = matchMedia('(max-width: 700px)').matches;
    const panels = data.rigs.map((rig, index) => renderRig(rig, expanded.get(rig.name) ?? (!compact || index === 0)));
    rigs.replaceChildren(...panels);
    if (currentFocus) panels.find(panel => panel.dataset.rig === currentFocus)?.querySelector('summary').focus({ preventScroll: true });
  } catch {
    status.textContent = 'Actualizarea a eșuat. Tabelele afișează ultima citire primită.';
    summary.replaceChildren();
  } finally {
    refresh.disabled = false;
  }
}
refresh.addEventListener('click', update);
update();
setInterval(update, 30_000);
