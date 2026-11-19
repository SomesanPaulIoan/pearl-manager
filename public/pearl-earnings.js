const card = document.querySelector('#pearl-earnings');
const selector = card.querySelector('select');
const modes = [...card.querySelectorAll('[data-mode]')];
const plot = card.querySelector('.earnings-plot');
const status = card.querySelector('[role="status"]');
const total = card.querySelector('#earnings-total');
const rows = card.querySelector('tbody');
const table = card.querySelector('details');
const number = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 });
const dayLabel = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const value = amount => number.format(amount) + ' PRL';
const coverage = day => day.complete ? '24 h' : `${day.coveredHours}/24 h complete${day.partialHours ? ' · ' + day.partialHours + ' h parțiale' : ''}`;
const labelDate = date => dayLabel.format(new Date(date + 'T00:00:00Z'));
const NS = 'http://www.w3.org/2000/svg';
let current;
let mode = 'daily';
let request;

function svgNode(tag, attributes, content) {
  const node = document.createElementNS(NS, tag);
  for (const [key, val] of Object.entries(attributes)) node.setAttribute(key, val);
  if (content) node.textContent = content;
  return node;
}

function draw() {
  const days = current?.points ?? [];
  if (!days.length) {
    plot.replaceChildren();
    return;
  }
  const width = Math.max(260, Math.round(plot.clientWidth));
  const height = width < 500 ? 202 : 260;
  const left = width < 500 ? 42 : 58;
  const right = width - 15;
  const top = 14;
  const bottom = height - 32;
  const span = (right - left) / days.length;
  const metric = mode === 'daily' ? 'prl' : 'cumulativePrl';
  const max = Math.max(1, ...days.map(day => day[metric] ?? 0));
  const step = 10 ** Math.floor(Math.log10(max));
  const ceiling = Math.ceil(max / (step / 2)) * (step / 2);
  const x = index => left + span * (index + .5);
  const y = amount => bottom - amount / ceiling * (bottom - top);
  const svg = svgNode('svg', {
    viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': mode === 'daily' ? 'Grafic PRL produse pe zi' : 'Grafic total PRL cumulativ în interval',
  });
  for (let tick = 0; tick <= 3; tick++) {
    const amount = ceiling * tick / 3;
    svg.append(svgNode('line', { x1: left, x2: right, y1: y(amount), y2: y(amount), class: 'earnings-gridline' }));
    svg.append(svgNode('text', { x: left - 6, y: y(amount) + 4, 'text-anchor': 'end' }, number.format(amount)));
  }
  const ticks = Math.min(days.length, width < 500 ? 4 : 7);
  for (let tick = 0; tick < ticks; tick++) {
    const index = Math.round(tick * (days.length - 1) / Math.max(1, ticks - 1));
    const position = Math.max(left, Math.min(right, x(index)));
    const anchor = index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle';
    svg.append(svgNode('text', { x: position, y: height - 9, 'text-anchor': anchor }, labelDate(days[index].date)));
  }
  days.forEach((day, index) => {
    const position = x(index);
    if (day.prl === null) {
      const missing = svgNode('line', { x1: position, x2: position, y1: bottom - 5, y2: bottom, class: 'earnings-gap' });
      missing.append(svgNode('title', {}, labelDate(day.date) + ' · fără date'));
      svg.append(missing);
      return;
    }
    const previous = days[index - 1];
    const kind = day.complete ? 'earnings-observed' : 'earnings-partial';
    let point;
    if (mode === 'daily') {
      const barWidth = Math.min(28, Math.max(1, span * .65));
      const barHeight = Math.max(2, bottom - y(day.prl));
      point = svgNode('rect', { x: position - barWidth / 2, y: bottom - barHeight, width: barWidth, height: barHeight, rx: 2, class: kind });
    } else {
      if (previous && previous.prl !== null) {
        svg.append(svgNode('line', { x1: x(index - 1), y1: y(previous.cumulativePrl), x2: position,
          y2: y(day.cumulativePrl), class: previous.complete && day.complete ? 'earnings-line' : 'earnings-line earnings-line-partial' }));
      }
      point = svgNode('circle', { cx: position, cy: y(day.cumulativePrl), r: Math.min(4, Math.max(2, span / 2)), class: kind });
    }
    point.append(svgNode('title', {}, `${labelDate(day.date)} · ${value(day[metric])} · ${coverage(day)}`));
    svg.append(point);
  });
  plot.replaceChildren(svg);
}

function render(data) {
  current = data;
  const logged = data.points.filter(day => day.prl !== null);
  const complete = logged.filter(day => day.complete).length;
  total.textContent = logged.length ? value(data.cumulativePrl) : '—';
  status.textContent = logged.length
    ? `${labelDate(data.points[0].date)} – ${labelDate(data.points.at(-1).date)} UTC · ${complete} din ${data.points.length} zile complete`
    : 'Pearl Fortune încă nu a furnizat citiri pentru acest interval.';
  table.hidden = !logged.length;
  rows.replaceChildren(...data.points.slice().reverse().map(day => {
    const row = document.createElement('tr');
    for (const text of [labelDate(day.date), day.prl === null ? '—' : value(day.prl),
      day.prl === null ? 'Fără date' : coverage(day)]) {
      row.insertCell().textContent = text;
    }
    return row;
  }));
  draw();
}

async function refresh() {
  request?.abort();
  const pending = new AbortController();
  request = pending;
  try {
    const response = await fetch('/api/mining/daily?days=' + selector.value, {
      cache: 'no-store', signal: AbortSignal.any([pending.signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error('Daily rewards API unavailable');
    const data = await response.json();
    if (!pending.signal.aborted) render(data);
  } catch {
    if (!pending.signal.aborted) status.textContent = 'Nu am putut actualiza datele Pearl Fortune.';
  }
}

for (const button of modes) button.addEventListener('click', () => {
  mode = button.dataset.mode;
  for (const candidate of modes) candidate.setAttribute('aria-pressed', String(candidate === button));
  draw();
});
selector.addEventListener('change', refresh);
new ResizeObserver(draw).observe(plot);
refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
