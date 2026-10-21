# Online Retail II: EDA and RFM Data Product

Source: [UCI Machine Learning Repository, dataset 502](https://archive.ics.uci.edu/dataset/502/online+retail+ii). A 43.5 MB xlsx with two sheets, 1,067,371 transactions, 01/12/2009 to 09/12/2011. Eight variables: InvoiceNo, StockCode, Description, Quantity, InvoiceDate, UnitPrice (sterling), CustomerID, Country. Notebook: `notebook/01_EDA.ipynb`. All values in GBP (£).

## What the EDA found, and the rules I decided on

I profiled all 1,067,371 rows and turned five findings into validated rules.

1. **Missing Customer ID** (243,007 rows, 22.8%). Missingness is not random: 37% in Jan 2011, 24.5% in the UK, 0% in Germany and the Netherlands. Real guest check-outs: I keep them for KPIs, drop them from customer analytics only.
2. **Exact duplicates.** 34,337 excess rows (3.2%) form 25,063 fully identical groups; only 4 differ by timestamp: double-recorded system entries, not twin purchases. I flag the excess copies as `is_duplicate` (`keep='first'`); sensitivity: £561,503 (2.9%).
3. **Cancellations.** 19,494 rows carry C invoices (official docs: C = cancellation). Bulk cancels pair with an order placed the day before; they are real business events: flag `is_cancel`, exclude from RFM, use for the return rate (7.4% of gross value).
4. **Non-product codes and bad debt.** I flag POST, D, M, BANK CHARGES, C2, DOT, PADS, AMAZONFEE and CRUK as `is_product = False` (99.5% survive) and drop 6 bad-debt invoices with negative prices from RFM.
5. **Extreme values.** Only 0.1% exceed |z|=3, and skew collapses to near normal on log1p. The donors note that many customers are wholesalers, so these rows are genuine bulk behaviour; I keep them.

## Why I run EDA before building anything in the database

I write SQL only for trusted rules. Evidence: I proved duplicates are timestamp-identical records, showed missing IDs are seasonal guest behaviour, and matched 85% of cancellations to their original orders. A wrong warehouse rule is quiet and expensive: dropping rows without Customer ID erases 13.2% of revenue.

## Data products (`data/processed/`)

- `retail_fact.parquet`: all 1,067,371 rows with `Revenue` and four flags, for sales dashboards.
- `retail_cleaned.parquet`: 776,622 rows (72.8%) over 5,861 customers, for RFM.
- Same rules, different filters: KPI layer totals £19,666,120 (guests included), RFM layer £17,072,526 (86.8%).

## RFM segments

Snapshot = last invoice + 1 day (2011-12-10). R and M use quintiles; F uses fixed bins (1, 2-3, 4-6, 7-12, 13+ invoices). Four groups cover the R x F grid: Champions 18.6%, Loyal 41.4%, At Risk 7.7%, Lost 32.2%. Monetary prioritises within each segment.

## Product categories (notebook/02_Feature_Engineering.ipynb)

The dataset ships no category column, so I build one. I reduce the 1,067,371 rows to 4,950 unique products and classify each into 14 main and 54 sub categories defined in `data/product_taxonomy.json`. I classify in two passes. First, keyword rules compiled from the taxonomy file, first match wins: 4,448 products (89.9%), with exact StockCode matches catching the 31 non-product rows. Second, I send the 502 products the rules miss to a local qwen2.5:3b model through Ollama, one product per request, because batching made the model copy its first answer down the batch. I keep category separate from theme: a Christmas mug stays Kitchen & Dining. The output is `data/processed/product_categories.parquet` with `StockCode`, `main_category` and `sub_category`, one row per StockCode. I record the matched rule for every assignment, so I can audit each category.

## SQL layer (`sql/`)

I wrote the SQL after the notebooks set the rules. `01_EDA` proved the five findings; `02_Feature_Engineering` classified the 4,950 products into 14 main and 54 sub categories; the queries then turn those rules into a database, nothing more.

`sql/01_fact_marts.sql` builds the raw view over the combined parquet, materialises `retail_fact` with the four validated flags (cancellation, guest, product, duplicate) plus `Revenue`, then aggregates the marts: monthly sales by country, monthly KPIs with the value-based return rate, product totals, and the RFM scores with their four segments. `sql/02_category_marts.sql` loads `dim_product` from the notebook's category file, rebuilds `mart_product` with categories, and adds `mart_category_monthly`. Both scripts end in checks that must match the notebook anchors; `retail.duckdb` holds the result read-only for the dashboard.

## Sales dashboard (`dashboard/`)

I owned this dashboard's plan from the start. The idea follows the data: one pipeline runs from the raw xlsx export, through the combined raw layer, into a fact table with validated flags in SQL, then the category layer, and ends in a dashboard anyone can read. I did not ask for "a dashboard"; I brought the pipeline, the palette and the rules.

Before any code I fixed the plan: Node with a read-only DuckDB API, Vite with React and Recharts, plain JavaScript, one query file, bound parameters, no UI kit. My listed skills (frontend-design, design-taste-frontend, impeccable, emil-design-eng) keep the screen on app rules.

The contract holds: money shows as gross, returns and net, every panel states which filters reach it, and `scripts/verify.js` ties every number to the layers below.

Run: `cd dashboard && npm run dev` (API on 8787, app on 5173).

- Layers in order: the two xlsx sheets combine into a raw layer; SQL builds retail_fact with dedup, cancellation and guest flags; marts aggregate monthly KPIs, countries, products and RFM; dim_product adds main and sub categories.
- The API owns the database: one read-only DuckDB connection, nine JSON routes, one function per panel in `queries.js`, filters bound as parameters, memory capped at 512MB so small machines survive it.
- The web app stays simple: one filter object in `App.jsx`, one `useApi` hook with a 200ms debounce and a sequence guard, six panels that load, fail and empty on their own.
