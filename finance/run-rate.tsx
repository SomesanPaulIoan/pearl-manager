import { useEffect, useState } from "react";
import QuickPurchase from "./purchase";

type LedgerRig = {
  id: string;
  name: string;
  capital_ron: string | null;
  remaining_capital_ron: string | null;
};
type RigEconomics = {
  id: string; name: string; hashrateHs: number | null; prl: number | null;
  revenueRon: number | null; energyRon: number | null; profitRon: number | null;
  prlPerKwh: number | null; breakEvenUsd: number | null;
};
type Mining = { periods: { hours: number; projected: boolean; rigs: RigEconomics[] }[]; tariff: number; overhead: number };
type Receipt = { category?: string; activity: string; type: string; cash_status: string; currency: string; amount: string; voided: boolean };
type Balance = { ok: true; amount: number } | { ok: false };
type PearlStatus = { wallet: Balance; fortune: Balance; price: Balance };
type Snapshot = { ledger: LedgerRig[]; mining: Mining; receipts: Receipt[]; pearl: PearlStatus | null };

const format = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 });
function amount(value: number | string | null, unit: string) {
  return value === null ? "—" : `${format.format(Number(value))} ${unit}`;
}

async function get(path: string, signal: AbortSignal) {
  const result = await fetch(path, { cache: "no-store", signal });
  if (!result.ok) throw new Error();
  return result.json();
}

export default function PearlRunRate({ revision, onPurchase }: { revision: number; onPurchase: () => void }) {
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
        const [ledger, mining, transactions, pearl] = await Promise.all([
          get("/api/financial/summary", signal),
          get("/api/profitability", signal), get("/api/financial/transactions", signal),
          get("/api/status", signal).catch(() => null),
        ]);
        if (!controller.signal.aborted) {
          setSnapshot({ ledger: ledger.by_rig, mining, receipts: transactions.rows, pearl });
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
  }, [revision]);

  function receiptsUsd(activity: string) {
    const receipts = snapshot?.receipts.filter(row =>
      row.activity === activity && !row.voided &&
      ((row.type === "revenue" && row.cash_status === "received") ||
       (row.category === "mining_fee" && row.type === "expense" && row.cash_status === "paid")));
    if (!receipts?.length || receipts.some(row => row.currency !== "USD")) return null;
    return receipts.reduce((cents, row) => cents + (row.type === "expense" ? -1 : 1) * Math.round(Number(row.amount) * 100), 0) / 100;
  }
  const vastUsd = receiptsUsd("vast");
  const pearlUsd = receiptsUsd("pearl");
  const pearl = snapshot?.pearl;
  const unsoldPrl = pearl?.wallet.ok && pearl.fortune.ok ? pearl.wallet.amount + pearl.fortune.amount : null;
  const unsoldUsd = unsoldPrl !== null && pearl?.price.ok ? unsoldPrl * pearl.price.amount : null;
  const pearlTotalUsd = pearlUsd !== null && unsoldUsd !== null ? pearlUsd + unsoldUsd : null;
  const day = snapshot?.mining.periods.find(period => period.hours === 24);
  const missingRates = day?.rigs?.filter(rig => rig.hashrateHs === null).map(rig => rig.name) ?? [];
  const incompleteRigHistory = Boolean(day && !day.projected && day.rigs?.some(rig => rig.prl === null));
  return (
    <section className="pearl-run-rate" aria-labelledby="pearl-run-rate-title">
      <div className="finance-heading"><h1 id="pearl-run-rate-title">Venit și recuperare pe rig</h1><a href="#registru">Mergi la registru ↓</a></div>
      {failed && <p role="status">Citirea datelor a eșuat. Reîncercăm automat.</p>}
      {!snapshot && !failed && <p role="status">Se citesc registrul și datele Pearl…</p>}
      {snapshot && <QuickPurchase rigs={snapshot.ledger} onSaved={onPurchase} />}
      {snapshot && !failed && <>
        <dl className="pearl-receipts" aria-label="Încasări și valoare Pearl">
          <div><dt>Recuperat din Vast</dt><dd>{amount(vastUsd, "USD")}</dd></div>
          <div><dt>Pearl încasat</dt><dd>{amount(pearlUsd, "USD")}</dd></div>
          <div><dt>Pearl nevândut</dt><dd>{amount(unsoldUsd, "USD")}</dd><small>{amount(unsoldPrl, "PRL")}</small></div>
          <div><dt>Total Pearl cu soldul curent</dt><dd>{amount(pearlTotalUsd, "USD")}</dd></div>
          <div><dt>Total Vast + Pearl cu soldul curent</dt><dd>{amount(vastUsd === null || pearlTotalUsd === null ? null : vastUsd + pearlTotalUsd, "USD")}</dd></div>
        </dl>
        <details className="finance-method">
          <summary>Cum sunt calculate estimările</summary>
          <p>Pearl nevândut include soldul din wallet și soldul Pearl Fortune, inclusiv recompensele în așteptare. Valoarea folosește prețul curent CoinGecko. Capitalul de recuperat din registru folosește încasările efective.</p>
          <p>{day?.projected ? "Proiecția pe 24 h folosește ritmul Pearl Fortune din ultima oră și ponderea hashrate-ului curent." : "Producția Pearl Fortune se împarte după ponderea hashrate-ului măsurat în fiecare oră."}</p>
          <p>La costul GPU se adaugă {Math.round(snapshot.mining.overhead * 100)}% pentru restul sistemului, la {amount(snapshot.mining.tariff, "lei/kWh")}. Capitalul rămas reflectă încasările alocate și costurile din registru.</p>
        </details>
        {day?.projected && missingRates.length > 0 && <p role="status">Hashrate indisponibil pentru {missingRates.join(", ")}. Alocarea așteaptă citiri complete.</p>}
        {incompleteRigHistory && <p role="status">Alocarea istorică pe rig va apărea când avem 24 de ore complete de hashrate pe toate rigurile.</p>}
        <div className="scroll" tabIndex={0} role="region" aria-label="Venituri și recuperare pe rig">
          <table><thead><tr>{["Rig", "Capital net", "De recuperat", "Hashrate", "PRL/zi", "Venit/zi", "Curent/zi", "Net/zi", "PRL/kWh", "Prag curent", "Recuperare la ritmul actual"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{snapshot.ledger.map(entry => {
              const rig = day?.rigs?.find(item => item.id === entry.id || item.name === entry.name);
              const rate = rig?.hashrateHs ?? null;
              const net = rig?.profitRon ?? null;
              const remaining = entry.remaining_capital_ron === null ? null : Number(entry.remaining_capital_ron);
              const recovery = remaining === 0 ? "Recuperat" : net !== null && net <= 0 ? "Net ≤ 0"
                : net !== null && remaining !== null ? amount(Math.ceil(remaining / net), "zile") : "—";
              return <tr key={entry.id}><th scope="row">{entry.name}</th>
                <td data-label="Capital net">{amount(entry.capital_ron, "lei")}</td><td data-label="De recuperat">{amount(entry.remaining_capital_ron, "lei")}</td>
                <td data-label="Hashrate">{amount(rate === null ? null : rate / 1e15, "PH/s")}</td><td data-label="PRL/zi">{amount(rig?.prl ?? null, "PRL")}</td><td data-label="Venit/zi">{amount(rig?.revenueRon ?? null, "lei")}</td><td data-label="Curent/zi">{amount(rig?.energyRon ?? null, "lei")}</td>
                <td data-label="Net/zi">{amount(net, "lei")}</td><td data-label="PRL/kWh">{amount(rig?.prlPerKwh ?? null, "")}</td><td data-label="Prag curent">{amount(rig?.breakEvenUsd ?? null, "USD/PRL")}</td><td data-label="Recuperare la ritmul actual">{recovery}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </>}
    </section>
  );
}
