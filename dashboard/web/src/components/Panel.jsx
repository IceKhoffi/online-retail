import { CHART_H } from "../theme.js";

/** Panel chrome: title, body with loading/error/empty, scope caption. */
export function Panel({ title, caption, state, isEmpty = (d) => !d, children, onRetry }) {
  const { data, loading, error } = state;
  const empty = !loading && !error && data !== null && isEmpty(data);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
      </header>
      {error ? (
        <div className="panel-msg" role="status">
          <p>Couldn't load this panel. {error}</p>
          {onRetry && (
            <button type="button" className="btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      ) : empty ? (
        <div className="panel-msg">
          <p>No rows match the current filters.</p>
        </div>
      ) : data === null && loading ? (
        <Skeleton height={CHART_H} />
      ) : (
        <div className={`panel-body${loading ? " is-refreshing" : ""}`}>{children}</div>
      )}
      {caption && <p className="caption">{caption}</p>}
    </section>
  );
}

export function Skeleton({ height = 120 }) {
  return (
    <div className="skel-stack" style={{ minHeight: height }} aria-hidden="true">
      <div className="skel" style={{ height: height * 0.7, width: "78%" }} />
      <div className="skel" style={{ height: height * 0.55, width: "64%" }} />
      <div className="skel" style={{ height: height * 0.4, width: "48%" }} />
    </div>
  );
}

/** Small segmented control (native buttons, aria-pressed). */
export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value ?? o}
          type="button"
          aria-pressed={String((o.value ?? o) === value)}
          onClick={() => onChange(o.value ?? o)}
        >
          {o.label ?? o}
        </button>
      ))}
    </div>
  );
}
