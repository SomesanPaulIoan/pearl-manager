import { useEffect, useState } from "react";

type LedgerRig = {
  id: string;
  name: string;
  capital_ron: string | null;
  remaining_capital_ron: string | null;
};
type Gpu = { mining: string; powerW: number | null };
type Rig = { name: string; financialRigId?: string; state: string; gpus: Gpu[]; minerHashrateHs?: number };
type Mining = { periods: { hours: number; prl: number | null; revenueRon: number | null }[]; tariff: number; overhead: number };
type Snapshot = { ledger: LedgerRig[]; rigs: Rig[]; mining: Mining };

const format = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 });
function amount(value: number | string | null, unit: string) {
  return value === null ? "—" : `${format.format(Number(value))} ${unit}`;
}

async function get(path: string, signal: AbortSignal) {
  const result = await fetch(path, { cache: "no-store", signal });
  if (!result.ok) throw new Error();
  return result.json();
}

export default function PearlRunRate() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
        const [ledger, fleet, mining] = await Promise.all([
          get("/api/financial/summary", signal), get("/api/rigs", signal),
          get("/api/profitability", signal),
        ]);
        if (!controller.signal.aborted) {
          setSnapshot({ ledger: ledger.by_rig, rigs: fleet.rigs, mining });
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, []);

  const observed = snapshot?.rigs ?? [];
  const miningCount = (rig: Rig) => rig.gpus.filter(gpu => ["container", "process"].includes(gpu.mining)).length;
  const complete = observed.length > 0 && observed.every(rig =>
    rig.state === "online" && rig.gpus.length > 0 && rig.gpus.every(gpu => gpu.mining !== "unknown"));
  const hasRates = complete && observed.every(rig => miningCount(rig) === 0 || (rig.minerHashrateHs ?? 0) > 0);
  const weight = (rig: Rig) => hasRates
    ? miningCount(rig) > 0 ? rig.minerHashrateHs ?? 0 : 0
    : miningCount(rig);
  const totalWeight = observed.reduce((sum, rig) => sum + weight(rig), 0);
  const day = snapshot?.mining.periods.find(period => period.hours === 24);
  const method = hasRates ? "proporțional cu hashrate-ul local raportat" : "proporțional cu numărul de GPU pe care este detectat minerul";
  return (
    <section className="pearl-run-rate" aria-labelledby="pearl-run-rate-title">
      <h1 id="pearl-run-rate-title">Venit și recuperare pe rig</h1>
      {failed && <p role="status">Citirea datelor a eșuat. Reîncercăm automat.</p>}
      {!snapshot && !failed && <p role="status">Se citesc registrul și datele Pearl…</p>}
      {snapshot && !failed && <>
        <p>Alocăm estimativ producția Pearl Fortune din ultimele 24 h {method}. {hasRates ? "" : "Calculul presupune contribuții egale per GPU."} Costul folosește consumul GPU curent, plus {Math.round(snapshot.mining.overhead * 100)}% pentru restul sistemului, la {amount(snapshot.mining.tariff, "lei/kWh")}.</p>
        <div className="scroll" tabIndex={0} role="region" aria-label="Venituri și recuperare pe rig">
          <table><thead><tr>{["Rig", "Capital net", "De recuperat", "PRL/zi", "Venit/zi", "Curent/zi", "Net/zi", "Recuperare la ritmul actual"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{snapshot.ledger.map(entry => {
              const rig = observed.find(item => item.financialRigId ? item.financialRigId === entry.id : item.name === entry.name);
              const share = rig && complete && totalWeight > 0 ? weight(rig) / totalWeight : null;
              const prl = day?.prl != null && share !== null ? day.prl * share : null;
              const revenue = day?.revenueRon != null && share !== null ? day.revenueRon * share : null;
              const power = rig?.state === "online" && rig.gpus.every(gpu => Number.isFinite(gpu.powerW))
                ? rig.gpus.reduce((sum, gpu) => sum + (gpu.powerW ?? 0), 0) : null;
              const cost = power === null ? null : power / 1000 * (1 + snapshot.mining.overhead) * 24 * snapshot.mining.tariff;
              const net = revenue === null || cost === null ? null : revenue - cost;
              const remaining = entry.remaining_capital_ron === null ? null : Number(entry.remaining_capital_ron);
              const recovery = remaining === 0 ? "Recuperat" : net !== null && net <= 0 ? "Net ≤ 0"
                : net !== null && remaining !== null ? amount(Math.ceil(remaining / net), "zile") : "—";
              return <tr key={entry.id}><th scope="row">{entry.name}</th>
                <td>{amount(entry.capital_ron, "lei")}</td><td>{amount(entry.remaining_capital_ron, "lei")}</td>
                <td>{amount(prl, "PRL")}</td><td>{amount(revenue, "lei")}</td><td>{amount(cost, "lei")}</td>
                <td>{amount(net, "lei")}</td><td>{recovery}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <p>Capitalul rămas vine din registru și reflectă încasările alocate și costurile înregistrate. Proiecția folosește venitul Pearl și curentul estimate aici.</p>
      </>}
    </section>
  );
}
