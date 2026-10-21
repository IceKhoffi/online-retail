import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
} from "recharts";
import { C, CHART_H } from "../theme.js";
import { Panel } from "../components/Panel.jsx";
import { useApi } from "../api.js";
import { gbp, shortMonth } from "../format.js";

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="tt">
      <div className="tt-title">{shortMonth(r.month)}</div>
      <div className="tt-row"><span>gross sales</span><b>{gbp(r.gross_revenue)}</b></div>
      <div className="tt-row"><span>returns</span><b>{gbp(r.returns_value)}</b></div>
      <div className="tt-row"><span>net revenue</span><b>{gbp(r.net_revenue)}</b></div>
      <div className="tt-row"><span>return rate</span><b>{r.return_rate_pct?.toFixed(1)}%</b></div>
    </div>
  );
}

export function ReturnsPanel({ qs }) {
  const [align, setAlign] = useState(false);
  const { data, loading, error } = useApi(
    qs ? `/api/returns?${qs}${align ? "&aligned=1" : ""}` : null,
  );
  const state = { data, loading, error };
  const chart = data?.series ?? [];
  const partial = chart.filter((r) => r.is_partial_month);

  return (
    <Panel
      title="Returns over time"
      state={state}
      isEmpty={(d) => !d.series?.length}
      caption={
        align
          ? "Aligned: returns read against their original order month, so the Q4 seasons carry the humps (~85% matched by StockCode + quantity)."
          : "Cancellation-month attribution: the Jan/Feb hump is Q4 orders returning weeks later, not an error · date range only."
      }
    >
      <div className="panel-tools">
        <label className="toggle">
          <input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} />
          align to order month
        </label>
      </div>
      <ResponsiveContainer width="100%" height={CHART_H}>
        <ComposedChart data={chart} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="month"
            type="category"
            tickFormatter={shortMonth}
            tick={C.axis}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            yAxisId="money"
            tickFormatter={(v) => `£${Math.round(v / 1e6)}M`}
            tick={C.axis}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            tickFormatter={(v) => `${Math.round(v)}%`}
            tick={C.axis}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip content={<Tip />} wrapperStyle={{ zIndex: 30 }} />
          {partials(partial)}
          <Line
            yAxisId="money"
            dataKey="gross_revenue"
            name="gross sales"
            stroke={C.gross}
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="money"
            dataKey="returns_value"
            name="returns"
            stroke={C.returns}
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="money"
            dataKey="net_revenue"
            name="net revenue"
            stroke={C.net}
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="rate"
            dataKey="return_rate_pct"
            name="return rate"
            stroke="#808080"
            strokeDasharray="2 3"
            strokeWidth={1.4}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function partials(months) {
  // On a category axis a ReferenceArea keyed to the month string spans
  // that month's column band.
  return months.map((m) => (
    <ReferenceArea
      key={m.month}
      yAxisId="money"
      x1={m.month}
      x2={m.month}
      fill="rgba(128,128,128,0.13)"
    />
  ));
}
