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
import { gbpCompact } from "../format.js";

const cut = (s) => (s.length > 20 ? `${s.slice(0, 20)}…` : s);

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="tt">
      <div className="tt-title">{r.Description}</div>
      <div className="tt-row">
        <span>StockCode</span>
        <b>{r.StockCode}</b>
      </div>
      <div className="tt-row">
        <span>gross sales</span>
        <b>{gbpCompact(r.gross_revenue)}</b>
      </div>
      <div className="tt-row">
        <span>units</span>
        <b>{Number(r.units_sold).toLocaleString("en-GB")}</b>
      </div>
    </div>
  );
}

export function ProductsPanel({ qs }) {
  const [metric, setMetric] = useState("gross_revenue");
  const [n, setN] = useState(8);
  const { data, loading, error } = useApi(
    qs ? `/api/products?${qs}&metric=${metric}&n=${n}` : null,
  );
  const state = { data, loading, error };
  const rows = data?.rows ?? [];

  // Recharts category axis renders the first array item at the TOP,
  // and rows already arrive rank-1 first: biggest bar on top.
  const chart = [...rows];

  return (
    <Panel
      title="Top products"
      state={state}
      isEmpty={(d) => !d.rows?.length}
      caption={
        rows.length
          ? `Top ${rows.length} in the current window · hover a bar for the full name and StockCode · volume vs value rankings barely overlap. All filters apply.`
          : "Top products in the current window."
      }
    >
      <div className="panel-tools">
        <Segmented
          label="Rank by"
          value={metric}
          options={[
            { value: "gross_revenue", label: "Revenue" },
            { value: "units_sold", label: "Units" },
          ]}
          onChange={setMetric}
        />
        <span className="caption-inline">all filters apply</span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart
          data={chart}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 0, left: 8 }}
        >
          <XAxis
            type="number"
            tickFormatter={(v) =>
              metric === "gross_revenue" ? gbpCompact(v) : String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
            }
            tick={C.axis}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="Description"
            width={128}
            tickFormatter={cut}
            tick={{ ...C.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(15,107,99,0.05)" }} wrapperStyle={{ zIndex: 30 }} />
          <Bar dataKey={metric} fill={C.net} radius={[0, 3, 3, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}
