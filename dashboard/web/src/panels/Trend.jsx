import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
} from "recharts";
import { C, CHART_H } from "../theme.js";
import { Panel, Segmented } from "../components/Panel.jsx";
import { useApi } from "../api.js";
import { gbpCompact } from "../format.js";

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function TooltipBox({ active, payload, rateMode }) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p) => p.value != null)
    .map((p) => [p.name, rateMode ? pct(p.value) : gbpFull(p.value)]);
  const mnum = payload[0]?.payload?.mnum;
  return (
    <div className="tt">
      <div className="tt-title">{MONTH_NAMES[mnum - 1]}</div>
      {rows.map(([k, v]) => (
        <div className="tt-row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

const pct = (v) => `${v.toFixed(1)}%`;
const gbpFull = (v) =>
  `£${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

export function TrendPanel({ qs }) {
  const { data, loading, error } = useApi(qs ? `/api/trend?${qs}` : null);
  const series = data?.series ?? [];
  const state = { data, loading, error };
  const [mode, setMode] = useState("Revenue");
  const rateMode = mode === "Return rate";
  const key = rateMode ? "return_rate_pct" : "net_revenue";

  const years = [...new Set(series.map((r) => Number(r.month.slice(0, 4))))].sort();
  const latest = years.at(-1);

  // One row per month 1..12; a column per year, aligned by month number.
  const chartData = MONTH_LETTERS.map((_, i) => {
    const row = { mnum: i + 1 };
    for (const y of years) {
      const hit = series.find(
        (r) => Number(r.month.slice(0, 4)) === y && Number(r.month.slice(5, 7)) === i + 1,
      );
      if (hit) row[String(y)] = hit[key];
    }
    return row;
  });

  return (
    <Panel
      title={rateMode ? "Monthly return rate, year over year" : "Monthly net revenue, year over year"}
      state={state}
      isEmpty={(d) => !d.series?.length}
      caption="Q4 peaks line up across years · grey band = partial December · follows the date range only, country, category and customer type don't reach this chart."
    >
      <div className="panel-tools">
        <Segmented
          label="Series"
          value={mode}
          options={["Revenue", "Return rate"]}
          onChange={setMode}
        />
        <span className="legend-note">latest year solid, earlier dashed</span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_H}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="mnum"
            type="number"
            domain={[0.6, 12.4]}
            ticks={MONTH_LETTERS.map((_, i) => i + 1)}
            tickFormatter={(v) => MONTH_LETTERS[v - 1]}
            tick={C.axis}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => gbpCompact(v)}
            tick={C.axis}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip content={<TooltipBox rateMode={rateMode} />} wrapperStyle={{ zIndex: 30 }} />
          <ReferenceArea x1={11.35} x2={12.65} fill="rgba(128,128,128,0.13)" />
          {years.map((y) => (
            <Line
              key={y}
              type="monotone"
              dataKey={String(y)}
              name={y}
              stroke={
                y === latest
                  ? rateMode
                    ? C.rateLatest
                    : C.net
                  : rateMode
                    ? C.rate
                    : C.netEarlier
              }
              strokeWidth={y === latest ? 2 : 1.5}
              strokeDasharray={y === latest ? undefined : "4 3"}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}
