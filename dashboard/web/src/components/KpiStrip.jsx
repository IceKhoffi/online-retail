import { gbpCompact, int, pct } from "../format.js";

/** KPI strip: six window metrics. Net revenue leads with a delta vs the
 *  same-length previous window; the other five show the current window. */
export function KpiStrip({ state }) {
  const { data, loading, error } = state;

  if (error) {
    return (
      <section className="kpis" aria-live="polite">
        <p className="panel-msg-inline">Couldn't load the KPIs. {error}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="kpis">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="kpi" key={i}>
            <span className="kpi-label skel-text" />
            <span className="kpi-value skel-text" />
          </div>
        ))}
      </section>
    );
  }

  const k = data.current;
  const p = data.previous;
  const delta =
    p.net_revenue > 0
      ? ((k.net_revenue - p.net_revenue) / p.net_revenue) * 100
      : null;

  const metrics = [
    { label: "Net revenue", value: gbpCompact(k.net_revenue) },
    { label: "Invoices", value: int(k.invoices) },
    { label: "Customers", value: int(k.active_customers) },
    { label: "Repeat customers", value: pct(k.repeat_pct) },
    { label: "Return rate", value: pct(k.return_rate_pct) },
    { label: "Avg order value", value: gbpCompact(k.aov) },
  ];

  return (
    <section className={`kpis${loading ? " is-refreshing" : ""}`} aria-live="polite">
      {metrics.map((m, i) => (
        <div className="kpi" key={m.label}>
          <span className="kpi-label">{m.label}</span>
          <span className="kpi-value num">{m.value}</span>
          {i === 0 &&
            (delta === null ? (
              <span className="kpi-delta">no previous window</span>
            ) : delta >= 0 ? (
              <span className="kpi-delta up">
                ▲ +{delta.toFixed(1)}% vs previous window
              </span>
            ) : (
              <span className="kpi-delta down">
                ▼ {delta.toFixed(1)}% vs previous window
              </span>
            ))}
        </div>
      ))}
    </section>
  );
}
