import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { C, CHART_H } from "../theme.js";
import { Panel, Segmented } from "../components/Panel.jsx";
import { useApi } from "../api.js";
import { gbp, gbpCompact, int } from "../format.js";

const METRICS = [
  { value: "net_revenue", label: "Net revenue" },
  { value: "gross_revenue", label: "Gross sales" },
  { value: "returns_value", label: "Returns" },
];

function fold(top8, rest) {
  // Recharts category axis renders the first array item at the TOP,
  // so the array must be [rank1..rank8, Other].
  const rows = [...top8];
  if (rest.length) {
    rows.push({
      Country: `Other (${rest.length})`,
      gross_revenue: rest.reduce((a, r) => a + r.gross_revenue, 0),
      returns_value: rest.reduce((a, r) => a + r.returns_value, 0),
      net_revenue: rest.reduce((a, r) => a + r.net_revenue, 0),
    });
  }
  return rows;
}

function CountryTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="tt">
      <div className="tt-title">{r.Country}</div>
      <div className="tt-row"><span>gross sales</span><b>{gbp(r.gross_revenue)}</b></div>
      <div className="tt-row"><span>returns</span><b>{gbp(r.returns_value)}</b></div>
      <div className="tt-row"><span>net revenue</span><b>{gbp(r.net_revenue)}</b></div>
    </div>
  );
}

export function CountriesPanel({ qs }) {
  const { data, loading, error } = useApi(qs ? `/api/countries?${qs}` : null);
  const state = { data, loading, error };
  const rows = data?.rows ?? [];
  const [metric, setMetric] = useState("net_revenue");
  const [log, setLog] = useState(false);

  const ranked = [...rows].sort((a, b) => b[metric] - a[metric]);
  const positive = log ? ranked.filter((r) => r[metric] > 0) : ranked;
  const chart = fold(positive.slice(0, 8), positive.slice(8));

  const share = rows.length
    ? (ranked[0].gross_revenue / rows.reduce((a, r) => a + r.gross_revenue, 0)) * 100
    : 0;

  return (
    <Panel
      title="Countries"
      state={state}
      isEmpty={(d) => !d.rows?.length}
      caption={`${ranked[0]?.Country ?? "no country"} is ${share.toFixed(0)}% of gross revenue in this view · date range and country filter apply, category and customer type don't.`}
    >
      <div className="panel-tools">
        <Segmented label="Metric" value={metric} onChange={setMetric} options={METRICS} />
        <label className="toggle num">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} />
          log scale
        </label>
      </div>
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart
          data={chart}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 0, left: 8 }}
        >
          <XAxis
            type="number"
            scale={log ? "log" : "linear"}
            domain={log ? ["auto", "auto"] : [0, "auto"]}
            allowDataOverflow={log}
            tickFormatter={(v) => gbpCompact(v)}
            tick={C.axis}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="Country"
            width={124}
            tick={{ ...C.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CountryTip />} cursor={{ fill: "rgba(15,107,99,0.05)" }} wrapperStyle={{ zIndex: 30 }} />
          <Bar dataKey={metric} fill={C.net} radius={[0, 3, 3, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}
