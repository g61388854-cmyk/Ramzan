import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export function Badge({ tone = "neutral", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; busy?: boolean }) {
  const { variant, size, busy, className, children, disabled, ...rest } = props;
  return (
    <button {...rest} disabled={disabled || busy} className={`btn ${variant ?? ""} ${size ?? ""} ${className ?? ""}`}>
      {busy ? "…" : null}
      {children}
    </button>
  );
}

export function Field({ label, required, hint, children, wide }: { label: string; required?: boolean; hint?: string | null; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>
        {label}
        {required ? <span className="req"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number | null; tone?: string }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? "active" : ""} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count ? <Badge tone={t.tone ?? "neutral"}>{t.count}</Badge> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export type Column<T> = { key: string; label: string; render?: (row: T) => ReactNode; sort?: (row: T) => string | number; className?: string };

export function DataTable<T extends { id?: string }>({ rows, columns, onRow, empty, initialSort }: {
  rows: T[]; columns: Column<T>[]; onRow?: (r: T) => void; empty?: ReactNode; initialSort?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ? { key: initialSort, dir: 1 } : null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a), y = col.sort!(b);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);
  if (!rows.length) return <Empty>{empty ?? "Записи отсутствуют"}</Empty>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.sort ? "sortable" : ""} onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((s.dir * -1) as 1 | -1) : 1 }))}
                aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={(r.id as string) ?? i} className={onRow ? "clickable" : ""} onClick={() => onRow?.(r)}
              tabIndex={onRow ? 0 : undefined} onKeyDown={(e) => onRow && e.key === "Enter" && onRow(r)}>
              {columns.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : (r as any)[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- уведомления -----------------------------------------------------------
type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// --- загрузка данных ---------------------------------------------------------
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

export function Loading({ error }: { error?: string | null }) {
  if (error) return <div className="notice danger">{error}</div>;
  return <div className="empty">Загрузка…</div>;
}
