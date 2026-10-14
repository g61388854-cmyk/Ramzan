import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { daysLeft, fmtDateTime } from "../lib/format";
import { Badge, Button, DataTable, Loading, Tabs, useAsync } from "../components/ui";
import { navigate } from "../lib/router";

const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export default function Deadlines() {
  const list = useAsync(() => api.get("/deadlines?days=400"), []);
  const [view, setView] = useState("calendar");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const byDay = useMemo(() => {
    const m: Record<string, any[]> = {};
    (list.data ?? []).forEach((d: any) => { if (d.due_at) { const k = new Date(d.due_at).toDateString(); (m[k] ??= []).push(d); } });
    return m;
  }, [list.data]);
  if (!list.data) return <Loading error={list.error} />;
  const today = new Date().toDateString();
  return (
    <div>
      <div className="page-head">
        <div className="grow"><h1>Процессуальные сроки</h1><div className="muted">Сроки по доступным делам; расчёты, не подтверждённые пользователем, отмечены</div></div>
      </div>
      <Tabs active={view} onChange={setView} tabs={[{ key: "calendar", label: "Календарь" }, { key: "list", label: "Список" }]} />
      {view === "calendar" ? (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <Button size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</Button>
            <b style={{ minWidth: 160, textAlign: "center" }}>{month.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</b>
            <Button size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</Button>
            <Button size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Сегодня</Button>
          </div>
          <div className="calendar">
            {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
            {days.map((d) => (
              <div key={d.toISOString()} className={`day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${d.toDateString() === today ? "today" : ""}`}>
                <div className="muted">{d.getDate()}</div>
                {(byDay[d.toDateString()] ?? []).map((x) => (
                  <a key={x.id} href={`#/cases/${x.case_id}?tab=deadlines`} className={`ev ${x.overdue ? "overdue" : ""} ${x.status === "unconfirmed" ? "unconfirmed" : ""}`} title={`${x.title} — дело ${x.case_number ?? x.case_reg_id}`}>{x.title}</a>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <DataTable rows={list.data} onRow={(r: any) => navigate(`/cases/${r.case_id}?tab=deadlines`)} initialSort="due" columns={[
          { key: "due", label: "Истекает", sort: (r: any) => r.due_at, render: (r: any) => fmtDateTime(r.due_at) },
          { key: "left", label: "Осталось", render: (r: any) => r.overdue ? <Badge tone="danger">просрочен</Badge> : <Badge tone={r.notify ? "warn" : "info"}>{daysLeft(r.due_at)} дн.</Badge> },
          { key: "title", label: "Срок", render: (r: any) => <>{r.title}<div className="small muted">{r.calculation?.basis}</div></> },
          { key: "case", label: "Дело", render: (r: any) => r.case_number ?? r.case_reg_id },
          { key: "st", label: "Расчёт", render: (r: any) => r.status === "confirmed" ? <Badge tone="ok">подтверждён</Badge> : <Badge tone="warn">не подтверждён</Badge> },
        ]} empty="Сроков нет" />
      )}
    </div>
  );
}
