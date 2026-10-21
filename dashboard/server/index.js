// index.js - read-only DuckDB -> JSON API for the dashboard.
// Plain node:http. One DuckDB instance opened READ_ONLY at boot; queries are
// serialised through a single connection (a queue: simple and safe).
//
// Routes (all GET, all JSON):
//   /api/meta            month bounds, countries, categories
//   /api/kpis            KPI strip: current window + previous window
//   /api/trend           mart_kpi_monthly over the window
//   /api/countries       country totals (date + country filters)
//   /api/products        top products (all filters)
//   /api/heatmap         weekday x hour (date, country, customer type)
//   /api/segments        RFM segment summary (no filters, by design)
//   /api/segments/:name  RFM drill-down
//   /api/returns         returns series (?aligned=1 re-attributes by order month)
//
// Filter params: start, end (YYYY-MM-01), countries (repeatable), category,
// customerType (All|Identified|Guest). Everything is validated against
// /api/meta values; bad input is a 400, never an SQL error.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import * as q from "./queries.js";

const PORT = Number(process.env.PORT) || 8787;
const HOST = "127.0.0.1";
const DB_PATH = fileURLToPath(new URL("../../sql/retail.duckdb", import.meta.url));
const DIST_DIR = fileURLToPath(new URL("../web/dist", import.meta.url));

// ---------------------------------------------------------------------------
// DuckDB: one read-only instance, queries serialised over one connection.
// ---------------------------------------------------------------------------

/** @type {{ instance: import('@duckdb/node-api').DuckDBInstance, con: import('@duckdb/node-api').DuckDBConnection, queue: Promise<any> }} */
const db = { instance: null, con: null, queue: Promise.resolve() };

/** Run one query, returning rows as plain JSON objects. Serialised. */
function run({ sql, params }) {
  const task = db.queue.then(async () => {
    const result = await db.con.run(sql, params);
    const rows = await result.getRowObjects();
    return rows.map(normalize);
  });
  // keep the queue alive even when a query fails
  db.queue = task.catch(() => {});
  return task;
}

/** JSON-friendly coercion: BigInt -> Number; HUGEINT arrives as string. */
function normalize(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") out[k] = Number(v);
    else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && k !== "StockCode") {
      out[k] = Number(v);
    } else out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filter parsing + validation
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;
/** @type {Set<string>} */
let validCountries = new Set();
/** @type {Set<string>} */
let validCategories = new Set();
let dataLo = "2009-12-01";
let dataHi = "2011-12-01";

/**
 * @param {URL} url
 * @returns {q.Filters}
 */
function parseFilters(url) {
  const p = url.searchParams;
  const start = p.get("start");
  const end = p.get("end");
  if (!start || !end || !MONTH_RE.test(start) || !MONTH_RE.test(end)) {
    throw new HttpError(400, "start and end must be YYYY-MM-01 dates");
  }
  if (start < dataLo) throw new HttpError(400, `start is before the data (${dataLo})`);
  if (end > dataHi) throw new HttpError(400, `end is after the data (${dataHi})`);
  if (start > end) throw new HttpError(400, "start must not be after end");

  const countries = p.getAll("countries");
  for (const c of countries) {
    if (!validCountries.has(c)) throw new HttpError(400, `unknown country: ${c}`);
  }
  const category = p.get("category") || "All";
  if (category !== "All" && !validCategories.has(category)) {
    throw new HttpError(400, `unknown category: ${category}`);
  }
  const customerType = p.get("customerType") || "All";
  if (!["All", "Identified", "Guest"].includes(customerType)) {
    throw new HttpError(400, `unknown customerType: ${customerType}`);
  }
  return { start, end, countries, category, customerType };
}

/** The same-length window immediately before `f`. */
function previousWindow(f) {
  const [y, m] = f.start.split("-").map(Number);
  const [ey, em] = f.end.split("-").map(Number);
  const nMonths = (ey - y) * 12 + (em - m) + 1;
  const endD = new Date(Date.UTC(y, m - 1 - 1, 1)); // one month before start
  const startD = new Date(Date.UTC(y, m - 1 - nMonths, 1));
  const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { ...f, start: iso(startD), end: iso(endD) };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function getMeta() {
  const [bounds, countryRows, categoryRows] = await Promise.all([
    run(q.monthBounds()),
    run(q.countryList()),
    run(q.categoryList()).catch((e) => {
      console.warn("[meta] dim_product unavailable, category filter disabled:", e.message);
      return [];
    }),
  ]);
  return {
    lo: bounds[0]?.lo ?? dataLo,
    hi: bounds[0]?.hi ?? dataHi,
    countries: countryRows.map((r) => r.Country),
    categories: categoryRows.map((r) => r.main_category),
  };
}

async function getKpis(f) {
  const [money, counts, prevMoney, prevCounts] = await Promise.all([
    run(q.kpiMoney(f)),
    run(q.kpiCounts(f)),
    run(q.kpiMoney(previousWindow(f))),
    run(q.kpiCounts(previousWindow(f))),
  ]);
  const shape = (m, c) => {
    const gross = m.gross_revenue ?? 0;
    const returns = m.returns_value ?? 0;
    const net = m.net_revenue ?? 0;
    const invoices = c.invoices ?? 0;
    return {
      gross_revenue: gross,
      returns_value: returns,
      net_revenue: net,
      invoices,
      active_customers: c.active_customers ?? 0,
      repeat_pct: c.repeat_pct ?? 0,
      aov: invoices > 0 ? net / invoices : 0,
      return_rate_pct: gross > 0 ? (returns / gross) * 100 : 0,
    };
  };
  const current = shape(money[0] ?? {}, counts[0] ?? {});
  const previous = shape(prevMoney[0] ?? {}, prevCounts[0] ?? {});
  return { current, previous };
}

async function getReturns(f, aligned) {
  const mart = await run(q.trend(f));
  if (!aligned) {
    return {
      attribution: "cancellation month",
      series: mart.map((r) => ({
        month: r.month,
        gross_revenue: r.gross_revenue,
        returns_value: r.returns_value,
        net_revenue: r.net_revenue,
        return_rate_pct: r.return_rate_pct,
        is_partial_month: !!r.is_partial_month,
      })),
    };
  }
  const alignedRows = await run(q.returnsByOrderMonth(f));
  const byMonth = new Map(alignedRows.map((r) => [r.month, r.returns_value]));
  const series = mart.map((r) => {
    const returns_value = byMonth.get(r.month) ?? 0;
    return {
      month: r.month,
      gross_revenue: r.gross_revenue,
      returns_value,
      net_revenue: r.gross_revenue - returns_value,
      return_rate_pct: r.gross_revenue > 0 ? (returns_value / r.gross_revenue) * 100 : 0,
      is_partial_month: !!r.is_partial_month,
    };
  });
  return { attribution: "order month", series };
}

const routes = {
  "/api/meta": async () => getMeta(),
  "/api/kpis": async (url) => getKpis(parseFilters(url)),
  "/api/trend": async (url) => ({ series: await run(q.trend(parseFilters(url))) }),
  "/api/countries": async (url) => ({ rows: await run(q.countries(parseFilters(url))) }),
  "/api/products": async (url) => {
    const f = parseFilters(url);
    const metric = url.searchParams.get("metric") || "gross_revenue";
    let n = Number(url.searchParams.get("n")) || 8;
    if (!Number.isInteger(n) || n < 1) n = 8;
    n = Math.min(n, 25);
    return { metric, rows: await run(q.topProducts(f, metric, n)) };
  },
  "/api/heatmap": async (url) => ({ rows: await run(q.dowHour(parseFilters(url))) }),
  "/api/segments": async () => ({ rows: await run(q.rfmSegments()) }),
  "/api/returns": async (url) => getReturns(parseFilters(url), url.searchParams.get("aligned") === "1"),
};

/** GET /api/segments/:name - segment name is a path segment. */
async function segmentDrilldown(name) {
  const valid = new Set((await run(q.rfmSegments())).map((r) => r.Segment));
  if (!valid.has(name)) throw new HttpError(404, `unknown segment: ${name}`);
  return { segment: name, rows: await run(q.rfmCustomers(name, 25)) };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname.startsWith("/api/segments/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/segments/".length));
      return sendJson(res, 200, await segmentDrilldown(name));
    }
    const handler = routes[url.pathname];
    if (!handler) throw new HttpError(404, `no route: ${url.pathname}`);
    return sendJson(res, 200, await handler(url));
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error("[api]", url.pathname, err);
    return sendJson(res, 500, { error: "internal error" });
  }
}

/** Serve the built SPA (web/dist) when it exists. */
async function handleStatic(res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = join(DIST_DIR, rel);
  if (!file.startsWith(DIST_DIR)) throw new HttpError(403, "forbidden");
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "not found (build the web app with: npm run build)" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" });
    return handleApi(req, res, url);
  }
  return handleStatic(res, url.pathname).catch((err) => {
    console.error("[static]", err);
    sendJson(res, 500, { error: "internal error" });
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

server.listen(PORT, HOST, async () => {
  try {
    db.instance = await DuckDBInstance.create(DB_PATH, {
      access_mode: "READ_ONLY",
      // This box may run in a small cgroup (~2GB). DuckDB's default buffer
      // pool is ~80% of HOST RAM (~6.5GB on an 8GB host), which gets the
      // whole process tree OOM-killed. Cap it; queries spill to disk if needed.
      memory_limit: process.env.DUCKDB_MEMORY || "512MB",
      threads: "2",
      // where spilled work goes when memory_limit is hit (db dir may be
      // non-writable in some sandboxes, keep it project-local)
      temp_directory: fileURLToPath(new URL("../.tmp/duckdb_spill", import.meta.url)),
    });
    db.con = await db.instance.connect();

    const meta = await getMeta();
    dataLo = meta.lo;
    dataHi = meta.hi;
    validCountries = new Set(meta.countries);
    validCategories = new Set(meta.categories);
    console.log(`[api] http://${HOST}:${PORT}`);
    console.log(`[api] data ${dataLo} .. ${dataHi}, ${meta.countries.length} countries, ${meta.categories.length} categories`);
  } catch (err) {
    console.error("[api] failed to open the database read-only:", err.message);
    process.exit(1);
  }
});
