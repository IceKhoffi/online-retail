-- =====================================================================
-- Online Retail II  |  RAW -> FACT -> MARTS  (DuckDB)
-- Every rule below is copied from 01_EDA.ipynb (section 7 and 8).
-- Run top to bottom. Adjust the parquet path if your working dir differs.
-- =====================================================================

-- ---------- 1. RAW (view over the parquet, nothing copied) -----------
CREATE OR REPLACE VIEW raw_transactions AS
SELECT * FROM '../data/processed/retail_raw_combined.parquet';


-- ---------- 2. FACT (table, every row kept, flags only) --------------
CREATE OR REPLACE TABLE retail_fact AS
SELECT
    *,
    starts_with(Invoice, 'C')                                   AS is_cancel,
    "Customer ID" IS NOT NULL                                   AS has_customer,
    COALESCE(UPPER(StockCode) NOT IN
        ('POST','D','M','BANK CHARGES','C2','DOT','PADS','AMAZONFEE','CRUK'), TRUE)
                                                                AS is_product,
    Quantity * Price                                            AS Revenue,
    -- excess copies of an identical row; the first copy is kept (= pandas keep='first')
    ROW_NUMBER() OVER (
        PARTITION BY Invoice, StockCode, Quantity, Price, InvoiceDate, "Customer ID"
        ORDER BY InvoiceDate
    ) > 1                                                       AS is_duplicate
FROM raw_transactions;


-- ---------- 3a. MART: monthly sales x country ------------------------
-- gross   = ~is_duplicate & is_product & Quantity>0 & Price>0   (guests included)
-- returns = is_cancel & ~is_duplicate, shown as a positive number
-- Never show a bare "revenue": always gross / returns / net.
CREATE OR REPLACE TABLE mart_sales_monthly AS
SELECT
    CAST(date_trunc('month', InvoiceDate) AS DATE)                                   AS month,
    Country,
    SUM(Revenue)  FILTER (WHERE is_product AND Quantity > 0 AND Price > 0)           AS gross_revenue,
    -SUM(Revenue) FILTER (WHERE is_cancel)                                           AS returns_value,
    COALESCE(SUM(Revenue) FILTER (WHERE is_product AND Quantity > 0 AND Price > 0), 0)
      + COALESCE(SUM(Revenue) FILTER (WHERE is_cancel), 0)                           AS net_revenue,
    COUNT(DISTINCT Invoice) FILTER (WHERE is_product AND Quantity > 0 AND Price > 0) AS invoices,
    COUNT(DISTINCT "Customer ID") FILTER (WHERE is_product AND Quantity > 0 AND Price > 0) AS customers
FROM retail_fact
WHERE NOT is_duplicate
GROUP BY 1, 2;


-- ---------- 3b. MART: monthly KPI + value-based return rate ----------
-- Return rate = |cancelled value| / gross product sales, SAME month
-- (cancellation-month attribution, as in the notebook headline view).
CREATE OR REPLACE TABLE mart_kpi_monthly AS
WITH m AS (
    SELECT month,
           COALESCE(SUM(gross_revenue), 0) AS gross_revenue,
           COALESCE(SUM(returns_value), 0) AS returns_value
    FROM mart_sales_monthly
    GROUP BY month
)
SELECT
    month,
    gross_revenue,
    returns_value,
    gross_revenue - returns_value                                   AS net_revenue,
    CASE WHEN gross_revenue > 0 THEN returns_value / gross_revenue * 100 ELSE 0 END
                                                                    AS return_rate_pct,
    -- first month and last month are partial (2009-12 start, 2011-12 ends on the 9th)
    month IN ((SELECT MIN(month) FROM m), (SELECT MAX(month) FROM m)) AS is_partial_month
FROM m
ORDER BY month;


-- ---------- 3c. MART: products ---------------------------------------
CREATE OR REPLACE TABLE mart_product AS
SELECT
    StockCode,
    mode(Description)        AS Description,   -- codes carry several description strings
    SUM(Quantity)            AS units_sold,
    SUM(Revenue)             AS gross_revenue,
    COUNT(DISTINCT Invoice)  AS invoices
FROM retail_fact
WHERE NOT is_duplicate AND is_product AND Quantity > 0 AND Price > 0
GROUP BY StockCode;


-- ---------- 4. MART: RFM (identified customers only) -----------------
-- Replaces retail_cleaned.parquet. snapshot = last invoice + 1 day.
-- R, M = quintiles with pandas qcut semantics (ties go by VALUE, not by row order).
-- F    = fixed bins 1 | 2-3 | 4-6 | 7-12 | 13+  -> 1..5
CREATE OR REPLACE TABLE mart_rfm AS
WITH lines AS (
    SELECT CAST("Customer ID" AS INTEGER) AS customer_id, Invoice, InvoiceDate, Revenue
    FROM retail_fact
    WHERE NOT is_duplicate AND NOT is_cancel AND has_customer
      AND Quantity > 0 AND Price > 0 AND is_product
),
snap AS (SELECT MAX(InvoiceDate) + INTERVAL 1 DAY AS snapshot FROM lines),
cust AS (
    SELECT
        customer_id,
        CAST(date_diff('second', MAX(InvoiceDate), (SELECT snapshot FROM snap)) // 86400 AS INTEGER) AS Recency,
        COUNT(DISTINCT Invoice) AS Frequency,
        SUM(Revenue)            AS Monetary
    FROM lines
    GROUP BY customer_id
),
edges AS (
    SELECT quantile_cont(Recency,  [0.2, 0.4, 0.6, 0.8]) AS r_e,
           quantile_cont(Monetary, [0.2, 0.4, 0.6, 0.8]) AS m_e
    FROM cust
),  
scored AS (
    SELECT
        c.*,
        5 - len(list_filter(e.r_e, x -> x < c.Recency))  AS R,   -- fewer days = better
        CASE WHEN c.Frequency <= 1  THEN 1
             WHEN c.Frequency <= 3  THEN 2
             WHEN c.Frequency <= 6  THEN 3
             WHEN c.Frequency <= 12 THEN 4
             ELSE 5 END                                   AS F,
        1 + len(list_filter(e.m_e, x -> x < c.Monetary)) AS M
    FROM cust c CROSS JOIN edges e
)
SELECT
    *,
    CASE WHEN R >= 4 AND F >= 4 THEN 'Champions'
         WHEN R >= 3            THEN 'Loyal'
         WHEN F >= 3            THEN 'At Risk'
         ELSE 'Lost' END AS Segment
FROM scored;


-- ---------- 5. MART: segment summary for the dashboard ---------------
CREATE OR REPLACE TABLE mart_rfm_segments AS
SELECT
    Segment,
    COUNT(*)                                          AS customers,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct_customers,
    ROUND(AVG(Recency), 1)   AS avg_recency,
    ROUND(AVG(Frequency), 1) AS avg_frequency,
    ROUND(AVG(Monetary), 1)  AS avg_monetary,
    SUM(Monetary)            AS total_monetary
FROM mart_rfm
GROUP BY Segment;


-- ---------- 6. CHECKS: must match the notebook ------------------------
-- fact rows            = 1,067,371
-- KPI gross revenue    ~ 19,666,120
-- segments             = Champions 18.6 | Loyal 41.4 | At Risk 7.7 | Lost 32.2 (%)
SELECT COUNT(*) AS fact_rows FROM retail_fact;
SELECT ROUND(SUM(gross_revenue)) AS gross_revenue FROM mart_kpi_monthly;
SELECT * FROM mart_rfm_segments ORDER BY customers DESC;
