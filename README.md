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
