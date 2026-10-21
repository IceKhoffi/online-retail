// verify.js - asserts the API's numbers against the notebook anchors.
// Requires the API to be running (npm start in another terminal, or
// `npm run dev` which starts both). BASE overrides the origin.
//
// Anchors (README / notebook):
//   gross revenue  ~ £19,666,120  (KPI layer, guests included)
//   RFM customers  = 5,861        (identified, lifetime)
//   return rate    ~ 7.4%         (cancellation-month attribution, value-based)
//   RFM money      ~ £17,072,526  (86.8% of the KPI layer)

const BASE = process.env.BASE || "http://127.0.0.1:8787";

let failures = 0;

function ok(label, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const fmtGBP = (x) => "£" + Math.round(x).toLocaleString("en-GB");

let meta;
try {
  meta = await get("/api/meta");
} catch (err) {
  console.error("FAIL  API not reachable:", err.message);
  process.exit(1);
}
ok("meta: month bounds", meta.lo === "2009-12-01" && meta.hi === "2011-12-01", `${meta.lo} .. ${meta.hi}`);
ok("meta: countries > 30", meta.countries.length > 30, `${meta.countries.length}`);
ok("meta: United Kingdom ranked first", meta.countries[0] === "United Kingdom");

const FULL = `start=${meta.lo}&end=${meta.hi}`;

const kpis = await get(`/api/kpis?${FULL}`);
const k = kpis.current;
ok(
  "kpis: gross revenue = £19,666,120 (±£1)",
  near(k.gross_revenue, 19666120, 1),
  fmtGBP(k.gross_revenue),
);
ok("kpis: identified customers = 5,861", k.active_customers === 5861, `${k.active_customers}`);
ok("kpis: return rate = 7.4% (±0.1pt)", near(k.return_rate_pct, 7.4, 0.1), `${k.return_rate_pct.toFixed(2)}%`);
console.log(`   ·  invoices ${k.invoices.toLocaleString("en-GB")} · repeat ${k.repeat_pct.toFixed(1)}% · aov ${fmtGBP(k.aov)}`);

// Previous-window sanity: with the full range selected there is no previous
// window, so the prior net revenue must be 0 and the delta suppressed.
ok("kpis: no delta over the full range", kpis.previous.net_revenue === 0, `${fmtGBP(kpis.previous.net_revenue)}`);

const trend = await get(`/api/trend?${FULL}`);
ok("trend: 25 months (Dec 2009 .. Dec 2011)", trend.series.length === 25, `${trend.series.length}`);
ok(
  "trend: partial flags on first+last month",
  trend.series.at(0).is_partial_month && trend.series.at(-1).is_partial_month,
);

const countries = await get(`/api/countries?${FULL}`);
ok("countries: UK leads by net revenue", countries.rows[0].Country === "United Kingdom", countries.rows[0].Country);

const products = await get(`/api/products?${FULL}&metric=gross_revenue&n=8`);
ok("products: 8 rows", products.rows.length === 8, `${products.rows.length}`);

const heatmap = await get(`/api/heatmap?${FULL}`);
const days = new Set(heatmap.rows.map((r) => r.weekday));
const grid = new Set(heatmap.rows.map((r) => `${r.weekday}-${r.hour}`));
ok("heatmap: rows for every cell that exists", grid.size === heatmap.rows.length, `${heatmap.rows.length} cells, ${days.size} weekdays`);
const satOrders = heatmap.rows.filter((r) => r.weekday === "Sat").reduce((a, r) => a + r.orders, 0);
const allOrders = heatmap.rows.reduce((a, r) => a + r.orders, 0);
ok("heatmap: Saturday nearly empty (<1% of orders)", satOrders / allOrders < 0.01, `${satOrders} of ${allOrders}`);

const segments = await get("/api/segments");
const segSum = segments.rows.reduce((a, r) => a + r.customers, 0);
const segMoney = segments.rows.reduce((a, r) => a + r.total_monetary, 0);
ok("segments: customers sum = 5,861", segSum === 5861, `${segSum}`);
ok("segments: RFM money = £17,072,526 (±£1)", near(segMoney, 17072526, 1), fmtGBP(segMoney));
ok("segments: revenue shares sum to 1", near(segments.rows.reduce((a, r) => a + r.revenue_share, 0), 1, 0.001));
const champion = segments.rows.find((r) => r.Segment === "Champions");
ok("segments: drill-down rows", (await get(`/api/segments/${encodeURIComponent("Champions")}`)).rows.length > 0, `Champions: ${champion.customers}`);

const returns = await get(`/api/returns?${FULL}`);
const aligned = await get(`/api/returns?${FULL}&aligned=1`);
const sum = (s) => s.series.reduce((a, r) => a + r.returns_value, 0);
ok(
  "returns: alignment preserves the total (±£0.50)",
  near(sum(aligned), sum(returns), 0.5),
  `${fmtGBP(sum(aligned))} vs ${fmtGBP(sum(returns))}`,
);

// Filtered smoke checks: a narrowed window and a country pick must not crash
// and must produce smaller numbers than the full range.
const narrowed = await get(`/api/kpis?start=2010-01-01&end=2010-12-01&countries=France&customerType=Identified`);
ok("kpis: narrowed window < full range gross", narrowed.current.gross_revenue < k.gross_revenue, fmtGBP(narrowed.current.gross_revenue));

console.log(`\n${failures ? `FAILED: ${failures} check(s)` : "ALL GREEN"}`);
process.exit(failures ? 1 : 0);
