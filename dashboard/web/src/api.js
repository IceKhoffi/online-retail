import { useEffect, useRef, useState } from "react";

/** Fetch JSON; throw a readable Error on non-2xx. */
export async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* keep the status line */
    }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * One panel's data lifecycle: loading, error, retry — with a sequence guard
 * so a late response can never overwrite a newer one, and an AbortController
 * so the browser stops waiting the moment the filters change.
 *
 * Aborting does not stop the server-side query; the sequence guard is what
 * guarantees correctness when responses land out of order.
 *
 * @param {string|null} url  null = do not fetch yet
 */
export function useApi(url) {
  const [state, setState] = useState({ data: null, loading: Boolean(url), error: null });
  const seq = useRef(0);

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const id = ++seq.current;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    getJson(url, ctrl.signal)
      .then((data) => {
        if (seq.current === id) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (seq.current === id && err.name !== "AbortError") {
          setState({ data: null, loading: false, error: err.message });
        }
      });
    return () => ctrl.abort();
  }, [url]);

  return state;
}

/** Debounced mirror of a value (filter inputs fire per keystroke). */
export function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Filters -> ?start=&end=&countries=&countries=&category=&customerType= */
export function toQuery(f) {
  const p = new URLSearchParams();
  p.set("start", f.start);
  p.set("end", f.end);
  for (const c of f.countries) p.append("countries", c);
  p.set("category", f.category);
  p.set("customerType", f.customerType);
  return p.toString();
}
