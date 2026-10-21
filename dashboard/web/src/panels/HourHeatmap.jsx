import { useState } from "react";
import { Panel, Segmented } from "../components/Panel.jsx";
import { useApi } from "../api.js";
import { gbp, int } from "../format.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function cell(value, max) {
  if (!max || !value) return {};
  const a = Math.sqrt(value / max); // sqrt keeps the tail visible
  return { background: `rgba(15, 107, 99, ${(a * 0.92).toFixed(3)})` };
}

export function HeatmapPanel({ qs }) {
  const { data, loading, error } = useApi(qs ? `/api/heatmap?${qs}` : null);
  const state = { data, loading, error };
  const rows = data?.rows ?? [];
  const [metric, setMetric] = useState("orders");
  const [hover, setHover] = useState(null); // {day, hour, text, x, y}

  const byKey = new Map(rows.map((r) => [`${r.weekday}-${r.hour}`, r]));
  const max = Math.max(0, ...rows.map((r) => r[metric] ?? 0));

  return (
    <Panel
      title="When customers order"
      state={state}
      isEmpty={(d) => !d.rows?.length}
      caption="Weekday × hour · hover a cell for the figure · Saturday is nearly empty, not missing · date, country and customer type apply; the category filter does not."
    >
      <div className="panel-tools">
        <Segmented
          label="Metric"
          value={metric}
          options={[
            { value: "orders", label: "Orders" },
            { value: "revenue", label: "Revenue" },
          ]}
          onChange={setMetric}
        />
        <span className="legend-note scale">
          low
          <i style={{ background: "rgba(15,107,99,0.15)" }} />
          <i style={{ background: "rgba(15,107,99,0.45)" }} />
          <i style={{ background: "rgba(15,107,99,0.75)" }} />
          <i style={{ background: "rgba(15,107,99,0.95)" }} />
          high
        </span>
      </div>
      <div className="hgrid-wrap">
        <div className="hgrid" role="img" aria-label="Orders by weekday and hour">
          <div className="hgrid-corner" />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className={`hgrid-col${h % 3 === 0 ? " show" : ""}`}>
              {h % 3 === 0 ? `${h}h` : ""}
            </div>
          ))}
          {DAYS.map((d) => (
            <div className="hgrid-row" key={d}>
              <div className="hgrid-day">{d}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const r = byKey.get(`${d}-${h}`);
                const v = r?.[metric] ?? 0;
                return (
                  <div
                    key={h}
                    className="hgrid-cell"
                    style={cell(v, max)}
                    onPointerEnter={(e) => {
                      const el = e.currentTarget;
                      setHover({
                        day: d,
                        hour: h,
                        text: r
                          ? `${metric === "orders" ? int(v) : gbp(v)}`
                          : "no orders",
                        x: el.offsetLeft + el.offsetWidth / 2,
                        y: el.offsetTop,
                      });
                    }}
                    onPointerLeave={() => setHover(null)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {hover && (
          <div className="tt hm-tip num" style={{ left: hover.x, top: hover.y - 6 }}>
            <div className="tt-title">
              {hover.day} {hover.hour}:00
            </div>
            <div className="tt-row">
              <span>{metric === "orders" ? "orders" : "revenue"}</span>
              <b>{hover.text}</b>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
