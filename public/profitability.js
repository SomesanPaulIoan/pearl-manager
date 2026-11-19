const section = document.querySelector('#profitability');
const detail = section.querySelector('[role="status"]');
const table = section.querySelector('table');
const body = table.tBodies[0];
const caption = section.querySelector("#production-period");
const summary = section.querySelector('#production24h');
const net = section.querySelector('#net24h');
const format = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 });
const rateFormat = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 6 });
const value = (number, unit) => number === null ? '—' : `${format.format(number)} ${unit}`;
const labels = {
  1: 'Ultima oră',
  24: '24 h',
  168: '7 zile',
  720: '30 de zile',
};

async function refresh() {
  try {
    const response = await fetch('/api/profitability', { cache: 'no-store', signal: AbortSignal.timeout(16_000) });
    if (!response.ok) throw new Error('Profitability HTTP error');
    const data = await response.json();
    const day = data.periods.find(period => period.hours === 24);
    caption.textContent = day.projected ? 'Proiecție PPS pe 24 h · ritmul ultimei ore' : 'Producție PPS · ultimele 24 de ore complete';
    summary.textContent = `${value(day.prl, 'PRL')} · ${value(day.revenueUsd, 'USD')}`;
    net.textContent = `Venit minus curent (24 h): ${value(day.profitRon, 'lei')}`;
    net.className = day.profitRon === null ? 'label' : day.profitRon < 0 ? 'label profit-negative' : 'label profit-positive';
    body.replaceChildren(...data.periods.map(period => {
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = period.hours === 1 ? labels[1]
        : period.projected ? `${labels[period.hours]} · proiecție (${period.coveredHours}/${period.hours} h)`
        : `${labels[period.hours]} · istoric`;
      row.append(label);
      for (const [metric, unit, name] of [
        ['prl', 'PRL', 'Producție'], ['revenueRon', 'lei', 'Venit'], ['energyKwh', 'kWh', 'Consum'], ['energyRon', 'lei', 'Curent'], ['profitRon', 'lei', 'Venit minus curent'],
      ]) {
        const cell = row.insertCell();
        cell.dataset.label = name;
        cell.textContent = value(period[metric], unit);
        if (metric === 'profitRon' && period[metric] !== null) {
          cell.className = period[metric] < 0 ? 'profit-negative' : 'profit-positive';
        }
      }
      return row;
    }));
    table.hidden = false;
    const power = data.wallKw === null
      ? 'Cost indisponibil până avem puterea tuturor rigurilor.'
      : `Putere estimată la priză: ${value(data.wallKw, 'kW')} din ${data.meteredGpus} GPU plus ${format.format(data.overhead * 100)}% pentru restul sistemului.`;
    const price = data.priceUsd === null ? 'Preț PRL indisponibil.' : `1 PRL ≈ ${rateFormat.format(data.priceUsd)} USD.`;
    const fx = data.usdRon === null ? 'Curs USD/RON indisponibil.' : `1 USD = ${rateFormat.format(data.usdRon)} lei (${data.fxDate}).`;
    const production = data.productionAt ? '' : 'Producția recentă PPS este indisponibilă. ';
    const missingEnergy = data.periods.some(period => period.hours > 1 && !period.projected && period.energyKwh === null)
      ? ' Unele intervale istorice au citiri incomplete de consum.' : '';
    detail.textContent = `${production}${price} ${fx} ${power} Tarif: ${value(data.tariff, 'lei/kWh')}.${missingEnergy}`;
  } catch {
    summary.textContent = '—';
    net.textContent = '';
    table.hidden = true;
    detail.textContent = 'Profitabilitatea nu este disponibilă momentan.';
  }
}
refresh();
setInterval(refresh, 60_000);
