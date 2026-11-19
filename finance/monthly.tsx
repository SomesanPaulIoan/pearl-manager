import { useEffect, useState } from "react";

type Cash = { id: string; name: string; vast_ron: string; pearl_ron: string; electricity_ron: string; opex_ron: string };
type Activity = { minutes: number; metered: number; costRon: number };
type Month = { activity: Record<string, { name: string; states: Record<string, Activity> }>; hours: number; coveredHours: number; meteredMinutes: number; prl: number | null; kwh: number | null; estimatedCostRon: number | null };
type Result = { kpis: Cash; by_rig: Cash[]; mining: Month };

const format = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 });
const label = (value: number | string | null, unit: string) => value === null ? "—" : `${format.format(Number(value))} ${unit}`;

export default function MonthlyReport({ revision }: { revision: number }) {
  const today = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(today);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const end = new Date(month + "-01T00:00:00Z");
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    const query = new URLSearchParams({ start: month + "-01", end: end.toISOString().slice(0, 10) });
    setResult(null);
    setFailed(false);
    Promise.all([
      fetch("/api/financial/summary?" + query, { cache: "no-store", signal }),
      fetch("/api/mining/monthly?month=" + month, { cache: "no-store", signal }),
    ]).then(responses => Promise.all(responses.map(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }))).then(([ledger, mining]) => {
      if (!controller.signal.aborted) setResult({ kpis: ledger.kpis, by_rig: ledger.by_rig, mining });
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [visible, month, revision]);

  return (
    <details className="pearl-run-rate monthly-report" onToggle={event => setVisible(event.currentTarget.open)}>
      <summary>Închidere lunară · Pearl și Vast</summary>
      <label>Lună <input type="month" value={month} max={today} onChange={event => setMonth(event.target.value)} /></label>
      {failed ? <p role="status">Raportul este indisponibil momentan.</p> : !result ? <p role="status">Se încarcă luna selectată…</p> : <>
        <dl className="pearl-receipts">
          <div><dt>Producție observată</dt><dd>{label(result.mining.prl, "PRL")}</dd><small>{result.mining.coveredHours}/{result.mining.hours} ore acoperite</small></div>
          <div><dt>Consum din citiri</dt><dd>{label(result.mining.kwh, "kWh")}</dd><small>{label(result.mining.estimatedCostRon, "lei estimați")} · {result.mining.meteredMinutes} min citite</small></div>
          <div><dt>Facturi curent înregistrate</dt><dd>{label(result.kpis.electricity_ron, "lei")}</dd></div>
          <div><dt>Alte cheltuieli plătite</dt><dd>{label(result.kpis.opex_ron, "lei")}</dd></div>
        </dl>
        <div className="scroll" tabIndex={0} role="region" aria-label="Încasări Pearl și Vast pe rig">
          <table>
            <thead><tr><th scope="col">Rig</th><th scope="col">Pearl încasat</th><th scope="col">Vast încasat</th><th scope="col">Facturi curent</th><th scope="col">Alte cheltuieli</th></tr></thead>
            <tbody>{[...result.by_rig, {...result.kpis, id:"total", name:"Total portofoliu"}].map(row => (
              <tr key={row.id}><th scope="row">{row.name}</th>
                <td data-label="Pearl încasat">{label(row.pearl_ron, "lei")}</td>
                <td data-label="Vast încasat">{label(row.vast_ron, "lei")}</td>
                <td data-label="Facturi curent">{label(row.electricity_ron, "lei")}</td>
                <td data-label="Alte cheltuieli">{label(row.opex_ron, "lei")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {Object.keys(result.mining.activity).length > 0 && <>
          <h3>Ore observate și cost pe activitate</h3>
          <div className="scroll" tabIndex={0} role="region" aria-label="Activitate și cost pe rig">
            <table><thead><tr><th scope="col">Rig</th>{["Pearl", "Vast", "Liber", "Mixt", "Necunoscut"].map(state =>
              <th scope="col" key={state}>{state}</th>)}</tr></thead>
              <tbody>{Object.entries(result.mining.activity).map(([id, rig]) => (
                <tr key={id}><th scope="row">{rig.name}</th>
                  {Object.entries({pearl:"Pearl",vast:"Vast",idle:"Liber",mixed:"Mixt",unknown:"Necunoscut"}).map(([key, name]) => {
                    const state = rig.states[key];
                    return <td key={key} data-label={name}>{state
                      ? `${label(state.minutes / 60, "h")} · ${label(state.metered ? state.costRon : null, "lei")}`
                      : "—"}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p>Activitatea Vast cere starea online și o închiriere raportată de Vast. Perioadele mixte și cele incerte sunt afișate separat. Costul folosește doar minutele cu putere citită.</p>
        </>}
        <p>Raportul include tranzacțiile datate din luna aleasă. Sumele fără dată rămân în registrul general. Consumul din senzori este separat de facturi și acoperă numai minutele colectate.</p>
      </>}
    </details>
  );
}
