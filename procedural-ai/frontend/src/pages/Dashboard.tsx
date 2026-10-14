import { useState } from "react";
import { api } from "../lib/api";
import { fmtDate, fmtDateTime, STATUS_TONE, FILE_STATUS, daysLeft } from "../lib/format";
import { navigate } from "../lib/router";
import { Badge, Button, Empty, Field, Loading, Modal, useAsync, useToast } from "../components/ui";

const ACTION_LABELS: Record<string, string> = {
  "case.create": "Создано дело", "case.update": "Изменена карточка дела", "file.upload": "Загружен материал",
  "document.create": "Сформирован проект", "document.version": "Сохранена версия документа", "document.export": "Экспорт документа",
  "document.status": "Изменён статус документа", "fact.confirmed": "Подтверждён факт", "fact.rejected": "Отклонён факт",
  "participant.create": "Добавлен участник", "deadline.create": "Зарегистрирован срок", "ai.draft": "Запрошен проект фрагмента",
};

export default function Dashboard() {
  const { data, error } = useAsync(() => api.get("/dashboard"), []);
  const [quick, setQuick] = useState(false);
  if (!data) return <Loading error={error} />;
  const c = data.counts;
  return (
    <div>
      <div className="page-head">
        <div className="grow"><h1>Главная панель</h1><div className="muted">Оперативные показатели по доступным делам</div></div>
        <Button variant="primary" onClick={() => setQuick(true)}>Быстрый запуск генератора</Button>
        <Button onClick={() => navigate("/cases?new=1")}>Новое дело</Button>
      </div>
      <div className="kpis">
        <div className="card kpi"><div className="v">{c.active_cases}</div><div className="l">Активные дела</div></div>
        <div className="card kpi"><div className="v">{c.in_work}</div><div className="l">Документы в разработке</div></div>
        <div className="card kpi"><div className="v">{c.needs_review}</div><div className="l">Требуют проверки</div></div>
        <div className="card kpi"><div className="v">{c.deadlines_14d}</div><div className="l">Сроки в ближайшие 14 дней</div></div>
      </div>
      <div className="cards">
        <div className="card">
          <h2>Последние дела</h2>
          <div className="list">
            {data.recent_cases.length ? data.recent_cases.map((x: any) => (
              <div className="item" key={x.id}>
                <div className="grow"><a href={`#/cases/${x.id}`}>{x.case_number || x.reg_id}</a><div className="small muted">{x.qualification || "квалификация не указана"}</div></div>
                <Badge>{x.stage_label}</Badge>
              </div>)) : <Empty>Нет дел</Empty>}
          </div>
        </div>
        <div className="card">
          <h2>Предстоящие процессуальные сроки</h2>
          <div className="list">
            {data.deadlines.length ? data.deadlines.map((d: any) => {
              const left = daysLeft(d.due_at);
              return (
                <div className="item" key={d.id}>
                  <div className="grow"><a href={`#/cases/${d.case_id}?tab=deadlines`}>{d.title}</a><div className="small muted">Дело {d.case_number || "—"}; до {fmtDateTime(d.due_at)}</div></div>
                  {d.overdue ? <Badge tone="danger">просрочен</Badge> : <Badge tone={left !== null && left <= 3 ? "warn" : "info"}>{left} дн.</Badge>}
                  {d.status === "unconfirmed" ? <Badge tone="warn" title="Расчёт не подтверждён пользователем">не подтв.</Badge> : null}
                </div>);
            }) : <Empty>Сроков в ближайшие 14 дней нет</Empty>}
          </div>
        </div>
        <div className="card">
          <h2>Требуют проверки</h2>
          <DocList items={data.documents_review} />
        </div>
        <div className="card">
          <h2>Документы в разработке</h2>
          <DocList items={data.documents_in_work} />
        </div>
        <div className="card">
          <h2>Незаполненные обязательные сведения</h2>
          <div className="list">
            {data.missing_data.length ? data.missing_data.map((m: any) => (
              <div className="item" key={m.case_id}><div className="grow"><a href={`#/cases/${m.case_id}`}>{m.case_number || m.reg_id}</a><div className="small muted">Не указано: {m.missing.join(", ")}</div></div></div>
            )) : <Empty>Пропусков в карточках не выявлено</Empty>}
          </div>
        </div>
        <div className="card">
          <h2>Последние загрузки материалов</h2>
          <div className="list">
            {data.recent_uploads.length ? data.recent_uploads.map((f: any) => (
              <div className="item" key={f.id}>
                <div className="grow"><a href={`#/cases/${f.case_id}?tab=files&file=${f.id}`}>{f.source_code} · {f.original_name}</a><div className="small muted">{fmtDateTime(f.uploaded_at)}</div></div>
                <Badge tone={FILE_STATUS[f.status]?.[1]}>{FILE_STATUS[f.status]?.[0] ?? f.status}</Badge>
              </div>)) : <Empty>Загрузок нет</Empty>}
          </div>
        </div>
        <div className="card">
          <h2>История действий</h2>
          <div className="list">
            {data.history.length ? data.history.map((h: any, i: number) => (
              <div className="item small" key={i}><span className="muted nowrap">{fmtDateTime(h.at)}</span><span className="grow">{ACTION_LABELS[h.action] ?? h.action}</span>
                {h.case_id ? <a href={`#/cases/${h.case_id}`}>дело</a> : null}</div>)) : <Empty>Действий нет</Empty>}
          </div>
        </div>
      </div>
      {quick ? <QuickStart cases={data.recent_cases} onClose={() => setQuick(false)} /> : null}
    </div>
  );
}

function DocList({ items }: { items: any[] }) {
  if (!items.length) return <Empty>Документов нет</Empty>;
  return (
    <div className="list">
      {items.map((d) => (
        <div className="item" key={d.id}>
          <div className="grow"><a href={`#/documents/${d.id}`}>{d.title}</a><div className="small muted">Дело {d.case_number || "—"} · {fmtDate(d.updated_at)}</div></div>
          <Badge tone={STATUS_TONE[d.status]}>{d.status_label}</Badge>
        </div>
      ))}
    </div>
  );
}

function QuickStart({ cases, onClose }: { cases: any[]; onClose: () => void }) {
  const toast = useToast();
  const cat = useAsync(() => api.get("/templates"), []);
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const d = await api.post(`/cases/${caseId}/documents`, { type_code: code, mode: "template" });
      navigate(`/documents/${d.id}`);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Быстрый запуск генератора" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" busy={busy} disabled={!caseId || !code} onClick={go}>Сформировать проект</Button></>}>
      <div className="col">
        <Field label="Уголовное дело">
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number || c.reg_id} — {c.qualification || ""}</option>)}
          </select>
        </Field>
        <Field label="Вид документа">
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">— выберите —</option>
            {cat.data?.sections.map((s: any) => (
              <optgroup key={s.code} label={s.label}>
                {cat.data.templates.filter((t: any) => t.section === s.code).map((t: any) => <option key={t.code} value={t.code}>{t.title}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
