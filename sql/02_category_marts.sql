-- =====================================================================
-- Category layer. Run AFTER build_marts.sql (needs retail_fact).
-- Edit the path / column names in section 1 to match your mapping file.
-- =====================================================================

-- ---------- 1. DIM: product -> main / sub category -------------------
-- Expected columns: StockCode, main_category, sub_category (one row per StockCode)
CREATE OR REPLACE TABLE dim_product AS
SELECT
    CAST(StockCode AS VARCHAR)                       AS StockCode,
    COALESCE(main_category, 'Uncategorised')         AS main_category,
    COALESCE(sub_category,  'Uncategorised')         AS sub_category
FROM '../data/processed/product_categories.parquet';   -- <-- your mapping file

-- CHECK 1 (must return 0 rows): one row per key, otherwise joins duplicate sales lines
SELECT StockCode, COUNT(*) AS n FROM dim_product GROUP BY 1 HAVING COUNT(*) > 1;


-- ---------- 2. mart_product, now with categories ---------------------
CREATE OR REPLACE TABLE mart_product AS
SELECT
    f.StockCode,
    mode(f.Description)                              AS Description,
    COALESCE(d.main_category, 'Uncategorised')       AS main_category,
    COALESCE(d.sub_category,  'Uncategorised')       AS sub_category,
    SUM(f.Quantity)                                  AS units_sold,
    SUM(f.Revenue)                                   AS gross_revenue,
    COUNT(DISTINCT f.Invoice)                        AS invoices
FROM retail_fact f
LEFT JOIN dim_product d ON d.StockCode = f.StockCode
WHERE NOT f.is_duplicate AND f.is_product AND f.Quantity > 0 AND f.Price > 0
GROUP BY f.StockCode, 3, 4;


-- ---------- 3. mart_category_monthly ---------------------------------
-- Same gross rule as the KPI mart; returns = cancellation lines (positive number).
CREATE OR REPLACE TABLE mart_category_monthly AS
SELECT
    CAST(date_trunc('month', f.InvoiceDate) AS DATE)                              AS month,
    COALESCE(d.main_category, 'Uncategorised')                                    AS main_category,
    COALESCE(d.sub_category,  'Uncategorised')                                    AS sub_category,
    SUM(f.Revenue)  FILTER (WHERE f.is_product AND f.Quantity > 0 AND f.Price > 0) AS gross_revenue,
    SUM(f.Quantity) FILTER (WHERE f.is_product AND f.Quantity > 0 AND f.Price > 0) AS units_sold,
    -SUM(f.Revenue) FILTER (WHERE f.is_cancel)                                    AS returns_value
FROM retail_fact f
LEFT JOIN dim_product d ON d.StockCode = f.StockCode
WHERE NOT f.is_duplicate
GROUP BY 1, 2, 3;



-- ---------- 4. CHECKS -------------------------------------------------
-- CHECK 2: difference must be 0 (category mart must not add or lose revenue)
SELECT ROUND((SELECT SUM(gross_revenue) FROM mart_category_monthly)
           - (SELECT SUM(gross_revenue) FROM mart_kpi_monthly), 2) AS gross_diff;

-- CHECK 3: how much revenue has no category (should be small)
SELECT main_category, ROUND(SUM(gross_revenue)) AS gross_revenue
FROM mart_category_monthly GROUP BY 1 ORDER BY 2 DESC;
