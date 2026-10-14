import { useState } from "react";
import { api, q } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Badge, DataTable, Loading, useAsync } from "../components/ui";

export default function Audit() {
  const [category, setCategory] = useState("");
  const [action, setAction] = useState("");
  const [failed, setFailed] = useState(false);
  const log = useAsync(() => api.get(`/audit${q({ category, action, success: failed ? false : undefined, limit: 500 })}`), [category, action, failed]);
  return (
    <div>
      <div className="page-head"><div className="grow"><h1>Журнал действий</h1><div className="muted">Значимые действия пользователей и события безопасности</div></div></div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select style={{ maxWidth: 220 }} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Все категории</option><option value="action">Действия</option><option value="security">Безопасность</option></select>
        <input style={{ maxWidth: 260 }} placeholder="Действие (например, case.access)" value={action} onChange={(e) => setAction(e.target.value)} />
        <label className="row small"><input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} /> Только отказы</label>
      </div>
      {log.data ? <DataTable rows={log.data} columns={[
        { key: "at", label: "Время", render: (r: any) => <span className="nowrap">{fmtDateTime(r.at)}</span> },
        { key: "u", label: "Пользователь", render: (r: any) => r.user_login ?? "—" },
        { key: "a", label: "Действие", render: (r: any) => <span className="mono">{r.action}</span> },
        { key: "c", label: "Категория", render: (r: any) => <Badge tone={r.category === "security" ? "warn" : "neutral"}>{r.category === "security" ? "безопасность" : "действие"}</Badge> },
        { key: "s", label: "Результат", render: (r: any) => r.success ? <Badge tone="ok">успешно</Badge> : <Badge tone="danger">отказ</Badge> },
        { key: "o", label: "Объект", render: (r: any) => <span className="small mono">{r.object_type ?? ""} {r.object_id ? r.object_id.slice(0, 8) : ""}</span> },
        { key: "ip", label: "IP", render: (r: any) => <span className="small mono">{r.ip ?? ""}</span> },
        { key: "d", label: "Сведения", render: (r: any) => <span className="small">{r.details ? JSON.stringify(r.details) : ""}</span> },
      ]} empty="Записей нет" /> : <Loading error={log.error} />}
    </div>
  );
}
