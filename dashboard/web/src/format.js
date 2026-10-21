/** £19,666,120 style -- full figures, tooltips, tables. */
export function gbp(x) {
  return `£${Number(x).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

/** £18.20M / £625k / £3 -- compact for KPI cards and axis labels. */
export function gbpCompact(x) {
  const a = Math.abs(Number(x) || 0);
  if (a >= 1e6) return `£${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `£${(x / 1e3).toFixed(0)}k`;
  return `£${Number(x).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

/** 3,847 style integer. */
export function int(x) {
  return Number(x).toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

/** 'Bill 10' style month label from '2011-03-01'. */
export function shortMonth(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function pct(x, decimals = 1) {
  return `${Number(x).toFixed(decimals)}%`;
}
