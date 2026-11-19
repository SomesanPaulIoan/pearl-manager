import { type FormEvent, useRef, useState } from "react";
import { api } from "./web/api";

type Rig = { id: string; name: string };

export default function QuickPurchase({ rigs, onSaved }: { rigs: Rig[]; onSaved: () => void }) {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const name = String(fields.get("name") ?? "").trim();
    const site = String(fields.get("site") ?? "").trim();
    const price = String(fields.get("price") ?? "").trim().replace(",", ".");
    setMessage("");
    setError(false);
    if (!name || !site || !/^\d+(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
      setMessage("Completează numele, site-ul și un preț pozitiv în lei (de exemplu 1250,50).");
      setError(true);
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      await api("/financial/asset", {
        rig_id: fields.get("rig"), model: name, vendor: site, purchase_amount: price,
        purchase_date: fields.get("date"), category: "hardware", currency: "RON",
        quantity: 1, status: "active", record_purchase: true,
      });
      form.reset();
      setMessage("Achiziția a fost salvată în registru și în inventarul rigului.");
      onSaved();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Achiziția nu a putut fi salvată.");
      setError(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="quick-purchase">
      <summary>+ Achiziție hardware</summary>
      <form onSubmit={submit}>
        <div className="purchase-rig"><label htmlFor="purchase-rig">Rig</label><select id="purchase-rig" required name="rig" defaultValue=""><option value="" disabled>Alege rigul</option>
          {rigs.map(rig => <option key={rig.id} value={rig.id}>{rig.name}</option>)}
        </select></div>
        <label>Nume<input required name="name" maxLength={300} /></label>
        <label>Site / magazin<input required name="site" maxLength={300} /></label>
        <label>Preț (lei)<input required name="price" inputMode="decimal" /></label>
        <label>Data achiziției<input required name="date" type="date" /></label>
        <button type="submit" disabled={busy}>{busy ? "Se salvează…" : "Salvează achiziția"}</button>
      </form>
      {message && <p role={error ? "alert" : "status"}>{message}</p>}
    </details>
  );
}
