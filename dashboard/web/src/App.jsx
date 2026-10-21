import { useEffect, useState } from "react";
import { useApi, useDebounced, toQuery } from "./api.js";
import { Filters } from "./components/Filters.jsx";
import { KpiStrip } from "./components/KpiStrip.jsx";
import { TrendPanel } from "./panels/Trend.jsx";
import { CountriesPanel } from "./panels/Countries.jsx";
import { ProductsPanel } from "./panels/Products.jsx";
import { HeatmapPanel } from "./panels/HourHeatmap.jsx";
import { SegmentsPanel } from "./panels/Segments.jsx";
import { ReturnsPanel } from "./panels/Returns.jsx";

const DEFAULTS = { start: "", end: "", countries: [], category: "All", customerType: "All" };

export default function App() {
  const meta = useApi("/api/meta");

  // Filters stay null until meta lands; the date bounds come from the data.
  const [filters, setFilters] = useState(null);
  useEffect(() => {
    if (meta.data && !filters) {
      setFilters({ ...DEFAULTS, start: meta.data.lo, end: meta.data.hi });
    }
  }, [meta.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ~200ms debounce: a slow old response can never fill a newer panel,
  // and the useApi sequence guard makes that true even without the debounce.
  const settled = useDebounced(filters, 200);
  const qs = settled && meta.data ? toQuery(settled) : null;

  // The KPI strip is fetched here (not inside the strip) because the
  // segments panel reuses its gross-revenue anchor for its footnote.
  const kpis = useApi(qs ? `/api/kpis?${qs}` : null);

  return (
    <div className="app">
      {meta.error && (
        <div className="panel-msg">
          <p>Couldn't load the dashboard metadata: {meta.error}</p>
          <p>Is the API running? Start everything with `npm run dev`.</p>
        </div>
      )}
      <header className="top">
        <div className="top-row">
          <h1>Online Retail · Sales Overview</h1>
          <span className="top-sub">Dec 2009 – Dec 2011 · all values GBP</span>
        </div>
        <Filters meta={meta.data} filters={filters} onFilters={setFilters} />
      </header>

      <KpiStrip state={kpis} />

      <main className="grid">
        <div className="cell cell-trend">
          <TrendPanel qs={qs} />
        </div>
        <div className="cell cell-side">
          <CountriesPanel qs={qs} />
        </div>
        <div className="cell cell-a">
          <ProductsPanel qs={qs} />
        </div>
        <div className="cell cell-b">
          <HeatmapPanel qs={qs} />
        </div>
        <div className="cell cell-a">
          <SegmentsPanel kpis={kpis} />
        </div>
        <div className="cell cell-b">
          <ReturnsPanel qs={qs} />
        </div>
      </main>

      <footer className="foot">
        Read-only over sql/retail.duckdb · gross / returns / net convention ·
        panels whose filters do not reach a mart say so in their caption.
      </footer>
    </div>
  );
}
