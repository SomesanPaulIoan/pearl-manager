import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { date: string; invested_ron: number; recovered_ron: number; vast_ron: number; pearl_ron: number; remaining_ron: number };
type History = { points: Point[]; reconstructed: string[]; undated: number; undatedSalesRon: number };
const currency = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" });
const tick = new Intl.NumberFormat("ro-RO", { notation: "compact", maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat("ro-RO", { month: "short", day: "numeric", timeZone: "UTC" });
const timestamp = (day: string) => Date.parse(day + "T00:00:00Z");

export default function CapitalEvolution({ start, end }: { start: string; end: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    setHistory(null);
    setError(false);
    const load = () => fetch("/api/financial/capital-history?" + params, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    }).then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }).then(data => {
      if (!controller.signal.aborted) { setHistory(data); setError(false); }
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [start, end]);

  const points = history?.points ?? [];
  const last = points.at(-1);
  return <section className="fin-box capital-evolution" aria-labelledby="capital-evolution-title">
    <h3 id="capital-evolution-title">Evoluția capitalului</h3>
    {!history && <p role="status">{error ? "Graficul este indisponibil momentan." : "Se încarcă istoricul capitalului…"}</p>}
    {history && !last && <p role="status">Nu sunt date în intervalul ales.</p>}
    {history && last && <>
      <p>{history.reconstructed.length
        ? "Încasările sunt repartizate pe zilele de producție. Capitalul urmărește achizițiile și vânzările hardware datate."
        : "Graficul folosește tranzacțiile cu dată din registru."}</p>
      <div className="capital-chart" role="img" aria-label="Capital net, venit operațional cumulat și capital rămas în lei">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points.map(point => ({ ...point, time: timestamp(point.date) }))} margin={{ top: 10, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#304459" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickCount={5} minTickGap={22}
              tickFormatter={value => shortDate.format(new Date(value))} stroke="#9eb3c7" tick={{ fontSize: 11 }} />
            <YAxis width={48} stroke="#9eb3c7" tick={{ fontSize: 11 }} tickFormatter={value => tick.format(value)} />
            <Tooltip labelFormatter={value => shortDate.format(new Date(Number(value)))}
              formatter={value => currency.format(Number(value))} contentStyle={{ background: "#152335", borderColor: "#304459", borderRadius: 8 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="invested_ron" name="Capital net" stroke="#98a9ff" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="recovered_ron" name="Venit operațional" stroke="#65deba" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line dataKey="remaining_ron" name="Capital de recuperat" stroke="#ffcc85" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <dl className="capital-totals">
        <div><dt>Vast cumulat</dt><dd>{currency.format(last.vast_ron)}</dd></div>
        <div><dt>Pearl cumulat</dt><dd>{currency.format(last.pearl_ron)}</dd></div>
        <div><dt>Total operațional cumulat</dt><dd>{currency.format(last.recovered_ron)}</dd></div>
      </dl>
      <p className="fin-footnote">
        {history.reconstructed.includes("vast") && "Vast urmează raportul zilnic de câștiguri. "}
        {history.reconstructed.includes("pearl") && "Pearl folosește repartizarea estimată după creditele PPS și prețul mediu zilnic. "}
        {history.undatedSalesRon > 0 && `Vânzările hardware fără dată (${currency.format(history.undatedSalesRon)}) rămân în totalurile registrului. `}
        {history.undated > 0 && `${history.undated} tranzacții fără dată sau conversie sunt excluse din cronologie.`}
      </p>
    </>}
  </section>;
}
