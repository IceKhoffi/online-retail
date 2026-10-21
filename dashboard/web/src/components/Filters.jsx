/**
 * Filter toolbar. Purely controlled: every change calls onFilters with the
 * next filters object. Native controls only (select, checkbox, month input).
 */
export function Filters({ meta, filters, onFilters }) {
  if (!meta || !filters) return null;

  const set = (patch) => onFilters({ ...filters, ...patch });

  const onMonth = (key, value) => {
    let next = { ...filters, [key]: `${value}-01` };
    if (next.start > next.end) {
      if (key === "start") next = { ...next, end: next.start };
      else next = { ...next, start: next.end };
    }
    onFilters(next);
  };

  const reset = () =>
    onFilters({
      start: meta.lo,
      end: meta.hi,
      countries: [],
      category: "All",
      customerType: "All",
    });

  return (
    <div className="filters">
      <div className="field">
        <label htmlFor="f-start">From</label>
        <input
          id="f-start"
          type="month"
          value={filters.start.slice(0, 7)}
          min={meta.lo.slice(0, 7)}
          max={meta.hi.slice(0, 7)}
          onChange={(e) => e.target.value && onMonth("start", e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="f-end">to</label>
        <input
          id="f-end"
          type="month"
          value={filters.end.slice(0, 7)}
          min={meta.lo.slice(0, 7)}
          max={meta.hi.slice(0, 7)}
          onChange={(e) => e.target.value && onMonth("end", e.target.value)}
        />
      </div>

      <details className="dd" data-count={filters.countries.length}>
        <summary>
          {filters.countries.length
            ? `Countries (${filters.countries.length})`
            : "All countries"}
        </summary>
        <div className="dd-list" role="group" aria-label="Countries">
          {meta.countries.map((c) => (
            <label key={c} className="check">
              <input
                type="checkbox"
                checked={filters.countries.includes(c)}
                onChange={(e) =>
                  set({
                    countries: e.target.checked
                      ? [...filters.countries, c]
                      : filters.countries.filter((x) => x !== c),
                  })
                }
              />
              {c}
            </label>
          ))}
        </div>
      </details>

      <div className="field">
        <label className="visually-hidden" htmlFor="f-cat">
          Category
        </label>
        <select
          id="f-cat"
          value={filters.category}
          onChange={(e) => set({ category: e.target.value })}
        >
          <option value="All">All categories</option>
          {meta.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="segmented" role="group" aria-label="Customer type">
        {[
          ["All", "All customers"],
          ["Identified", "Accounts"],
          ["Guest", "Guests"],
        ].map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={String(filters.customerType === v)}
            onClick={() => set({ customerType: v })}
          >
            {label}
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-ghost" onClick={reset}>
        Reset
      </button>
    </div>
  );
}
