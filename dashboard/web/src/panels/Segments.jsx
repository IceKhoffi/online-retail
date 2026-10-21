import { useState } from "react";
import { Panel } from "../components/Panel.jsx";
import { useApi } from "../api.js";
import { gbp, gbpCompact, int, pct } from "../format.js";

/** Drill-down lives in its own component so it fetches only when open. */
function Drilldown({ name }) {
  const state = useApi(`/api/segments/${encodeURIComponent(name)}`);
  const rows = state.data?.rows ?? [];

  return (
    <div className="drill">
      {state.error ? (
        <p className="panel-msg-inline">Couldn't load: {state.error}</p>
      ) : state.loading ? (
        <p className="panel-msg-inline">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Customer ID</th>
              <th className="r">Recency (days)</th>
              <th className="r">Invoices</th>
              <th className="r">Spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer_id}>
                <td className="num">{r.customer_id}</td>
                <td className="num r">{int(r.Recency)}</td>
                <td className="num r">{int(r.Frequency)}</td>
                <td className="num r">{gbp(r.Monetary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function SegmentsPanel({ kpis }) {
  const { data, loading, error } = useApi("/api/segments");
  const state = { data, loading, error };
  const rows = data?.rows ?? [];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(rows[0]?.Segment ?? "");

  const rfmMoney = rows.reduce((a, r) => a + r.total_monetary, 0);
  const kpiMoney = kpis.data?.current?.gross_revenue;

  return (
    <Panel
      title="Customer segments"
      state={state}
      isEmpty={(d) => !d.rows?.length}
      caption={
        kpiMoney
          ? `Lifetime snapshot of identified customers, filters don't apply · RFM layer ${gbpCompact(rfmMoney)} vs KPI layer ${gbpCompact(kpiMoney)} differ by design (no cancellations in RFM).`
          : "Lifetime snapshot of identified customers, filters don't apply."
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>Segment</th>
            <th className="r">Customers</th>
            <th className="r">% of customers</th>
            <th className="r">Avg spend</th>
            <th className="r">Revenue</th>
            <th className="r">% of revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.Segment}>
              <td>{r.Segment}</td>
              <td className="num r">{int(r.customers)}</td>
              <td className="num r">{pct(r.pct_customers)}</td>
              <td className="num r">{gbp(r.avg_monetary)}</td>
              <td className="num r">{gbp(r.total_monetary)}</td>
              <td className="num r">{pct(r.revenue_share * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="drill-wrap">
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide drill-down" : "Drill down into one segment"}
        </button>
        {open && (
          <div className="drill">
            <div className="field">
              <label className="visually-hidden" htmlFor="drill-seg">
                Segment
              </label>
              <select id="drill-seg" value={name} onChange={(e) => setName(e.target.value)}>
                {rows.map((r) => (
                  <option key={r.Segment} value={r.Segment}>
                    {r.Segment}
                  </option>
                ))}
              </select>
            </div>
            <Drilldown key={name} name={name} />
          </div>
        )}
      </div>
    </Panel>
  );
}
