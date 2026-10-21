// queries.js - ALL SQL lives here. One function per panel.
// Every value that comes from the UI is bound as a parameter ($1, $2, ...).
// The only interpolation is the metric whitelist in topProducts().
//
// Money always surfaces as gross / returns / net (never a bare "revenue").
// Dates are CAST to VARCHAR in SQL so the JSON layer never sees DuckDB
// date objects; counts are ::INT and sums ::DOUBLE so JSON gets numbers.

/** @typedef {{start: string, end: string, countries: string[], category: string, customerType: 'All'|'Identified'|'Guest'}} Filters */

// ---------------------------------------------------------------------------
// Filter fragments (return SQL text + bound params, or null when inactive)
// ---------------------------------------------------------------------------

/** Month range over InvoiceDate for on-the-fly retail_fact scans. */
function factDateRange(filters) {
  return {
    sql: "InvoiceDate >= CAST($1 AS TIMESTAMP) AND InvoiceDate < CAST($2 AS TIMESTAMP) + INTERVAL 1 MONTH",
    params: [filters.start, filters.end],
  };
}

/** Country condition, or null when every country is in scope. */
function countryCond(filters, startIdx) {
  if (!filters.countries.length) return null;
  const params = filters.countries.map((c, i) => [`${startIdx + i}`, c]);
  const marks = filters.countries.map((_, i) => `$${startIdx + i}`);
  return { sql: `Country IN (${marks.join(", ")})`, params: params.map((p) => p[1]) };
}

/** Shared WHERE for retail_fact: dedup + product lines + period + country +
 *  customer type. $1/$2 are always the period bounds, $3.. the country list. */
function factWhere(filters) {
  const w = ["NOT is_duplicate", "is_product", factDateRange(filters).sql];
  const params = [filters.start, filters.end];
  const cond = countryCond(filters, 3);
  if (cond) {
    w.push(cond.sql);
    params.push(...cond.params);
  }
  if (filters.customerType === "Identified") w.push("has_customer");
  else if (filters.customerType === "Guest") w.push("NOT has_customer");
  return { sql: w.join(" AND "), params };
}

// ---------------------------------------------------------------------------
// Panel queries: each returns { sql, params }
// ---------------------------------------------------------------------------

export function monthBounds() {
  return {
    sql: "SELECT CAST(MIN(month) AS VARCHAR) AS lo, CAST(MAX(month) AS VARCHAR) AS hi FROM mart_kpi_monthly",
    params: [],
  };
}

export function countryList() {
  return {
    sql: "SELECT Country, SUM(gross_revenue)::DOUBLE AS gross FROM mart_sales_monthly GROUP BY Country ORDER BY gross DESC",
    params: [],
  };
}

export function categoryList() {
  return {
    sql: "SELECT DISTINCT main_category FROM dim_product ORDER BY main_category",
    params: [],
  };
}

/** Period money from mart_sales_monthly. Date range only: country, category
 *  and customer type do not reach this mart (the panel captions that). */
export function kpiMoney(filters) {
  return {
    sql: `SELECT COALESCE(SUM(gross_revenue), 0)::DOUBLE AS gross_revenue,
                 COALESCE(SUM(returns_value), 0)::DOUBLE AS returns_value,
                 COALESCE(SUM(net_revenue), 0)::DOUBLE AS net_revenue
          FROM mart_sales_monthly
          WHERE month >= CAST($1 AS DATE) AND month <= CAST($2 AS DATE)`,
    params: [filters.start, filters.end],
  };
}

/** Invoice / customer counts over retail_fact for the period. */
export function kpiCounts(filters) {
  const w = factWhere(filters);
  const params = [...w.params];
  // renumber: factWhere already numbered $1..$n in order of appearance
  const countSql = `
    WITH per_inv AS (
      SELECT Invoice, MIN("Customer ID") AS customer_id, MIN(has_customer) AS has_customer
      FROM retail_fact
      WHERE ${w.sql} AND Quantity > 0 AND Price > 0
      GROUP BY Invoice
    ),
    per_cust AS (
      SELECT customer_id, COUNT(*) AS cnt
      FROM per_inv
      WHERE has_customer
      GROUP BY customer_id
    )
    SELECT (SELECT COUNT(*) FROM per_inv)::INT AS invoices,
           (SELECT COUNT(DISTINCT customer_id) FROM per_inv)::INT AS active_customers,
           (SELECT AVG(CASE WHEN cnt >= 2 THEN 1.0 ELSE 0.0 END) * 100 FROM per_cust)::DOUBLE AS repeat_pct`;
  return { sql: countSql, params };
}

/** Monthly KPI series from mart_kpi_monthly. Date range only. */
export function trend(filters) {
  return {
    sql: `SELECT CAST(month AS VARCHAR) AS month, gross_revenue, returns_value,
                 net_revenue, return_rate_pct, is_partial_month
          FROM mart_kpi_monthly
          WHERE month >= CAST($1 AS DATE) AND month <= CAST($2 AS DATE)
          ORDER BY month`,
    params: [filters.start, filters.end],
  };
}

/** gross / returns / net by country. Date + country filters apply. */
export function countries(filters) {
  const cond = countryCond(filters, 3);
  const where = cond ? `AND ${cond.sql}` : "";
  return {
    sql: `SELECT Country,
                 SUM(gross_revenue)::DOUBLE AS gross_revenue,
                 SUM(returns_value)::DOUBLE AS returns_value,
                 SUM(net_revenue)::DOUBLE   AS net_revenue
          FROM mart_sales_monthly
          WHERE month >= CAST($1 AS DATE) AND month <= CAST($2 AS DATE) ${where}
          GROUP BY Country
          ORDER BY net_revenue DESC`,
    params: [filters.start, filters.end, ...(cond ? cond.params : [])],
  };
}

/** Top-N products, on the fly from retail_fact + dim_product so every
 *  filter applies. `metric` is whitelisted, n is clamped by the caller. */
export function topProducts(filters, metric, n) {
  if (metric !== "gross_revenue" && metric !== "units_sold") {
    throw new Error("metric must be gross_revenue or units_sold");
  }
  const w = factWhere(filters);
  const cat = filters.category;
  const params = [...w.params];
  let catCond = "";
  if (cat && cat !== "All") {
    catCond = `AND COALESCE(d.main_category, 'Uncategorised') = $${params.length + 1}`;
    params.push(cat);
  }
  return {
    sql: `SELECT f.StockCode, mode(f.Description) AS Description,
                 SUM(f.Revenue)::DOUBLE  AS gross_revenue,
                 SUM(f.Quantity)::DOUBLE AS units_sold
          FROM retail_fact f
          LEFT JOIN dim_product d ON d.StockCode = f.StockCode
          WHERE ${w.sql} AND f.Quantity > 0 AND f.Price > 0 ${catCond}
          GROUP BY f.StockCode
          ORDER BY ${metric} DESC
          LIMIT ${n}`,
    params,
  };
}

/** Weekday x hour order pattern. On the fly: no mart has this grain.
 *  Date, country and customer type apply; the category filter does not. */
export function dowHour(filters) {
  const w = factWhere(filters);
  return {
    sql: `SELECT datepart('isodow', InvoiceDate)::INT AS isodow,
                 strftime(InvoiceDate, '%a') AS weekday,
                 datepart('hour', InvoiceDate)::INT AS hour,
                 COUNT(DISTINCT Invoice)::INT AS orders,
                 SUM(Revenue)::DOUBLE AS revenue
          FROM retail_fact
          WHERE ${w.sql} AND Quantity > 0 AND Price > 0
            AND EXISTS (
              SELECT 1 FROM retail_fact f2
              WHERE f2.Invoice = retail_fact.Invoice
                AND f2.is_product AND NOT f2.is_duplicate
                AND f2.Quantity > 0 AND f2.Price > 0
            )
          GROUP BY isodow, weekday, hour
          ORDER BY isodow, hour`,
    params: w.params,
  };
}

/** Segment summary. Filter-proof by design: RFM is a lifetime snapshot. */
export function rfmSegments() {
  return {
    sql: `SELECT Segment, customers, pct_customers, avg_recency, avg_frequency,
                 avg_monetary, total_monetary,
                 (total_monetary / SUM(total_monetary) OVER ())::DOUBLE AS revenue_share
          FROM mart_rfm_segments
          ORDER BY total_monetary DESC`,
    params: [],
  };
}

/** Drill-down: highest-money customers of one segment. */
export function rfmCustomers(segment, n) {
  return {
    sql: `SELECT customer_id, Recency, Frequency, Monetary
          FROM mart_rfm
          WHERE Segment = ?
          ORDER BY Monetary DESC
          LIMIT ?`,
    params: [segment, n],
  };
}

/** Returns re-attributed to the ORIGINAL order month (~85% matched by
 *  StockCode + Quantity, most recent order on or before the cancel).
 *  Total is preserved by construction; unmatched lines (~15%) keep their
 *  cancellation month. Date range only. */
export function returnsByOrderMonth(filters) {
  const [start, end] = [filters.start, filters.end];
  return {
    sql: `
      WITH c AS (
        SELECT Invoice, StockCode, -Quantity AS qty, Price, "Customer ID" AS cid,
               InvoiceDate AS cancel_date, Revenue
        FROM retail_fact
        WHERE is_cancel AND NOT is_duplicate
          AND InvoiceDate >= CAST($1 AS TIMESTAMP)
          AND InvoiceDate <  CAST($2 AS TIMESTAMP) + INTERVAL 1 MONTH
      ),
      o AS (
        SELECT StockCode, Quantity, InvoiceDate
        FROM retail_fact
        WHERE NOT is_cancel AND NOT is_duplicate AND is_product
          AND Quantity > 0 AND Price > 0
      ),
      matched AS (
        SELECT c.cancel_date, c.Revenue, o.InvoiceDate AS order_date
        FROM c LEFT JOIN o
          ON o.StockCode = c.StockCode
         AND o.Quantity = c.qty
         AND o.InvoiceDate <= c.cancel_date
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY c.Invoice, c.StockCode, c.qty, c.Price, c.cid, c.cancel_date
          ORDER BY o.InvoiceDate DESC
        ) = 1
      )
      SELECT CAST(CAST(date_trunc('month', COALESCE(order_date, cancel_date)) AS DATE) AS VARCHAR) AS month,
             SUM(-Revenue)::DOUBLE AS returns_value
      FROM matched
      GROUP BY 1
      ORDER BY 1`,
    params: [start, end],
  };
}
