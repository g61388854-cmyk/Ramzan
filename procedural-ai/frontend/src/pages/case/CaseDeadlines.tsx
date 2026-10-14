import { useState } from "react";
import { api } from "../../lib/api";
import { daysLeft, fmtDateTime } from "../../lib/format";
import { Badge, Button, DataTable, Field, Loading, Modal, useAsync, useToast } from "../../components/ui";
import type { CaseTabProps } from "../CaseView";

const ST: Record<string, [string, string]> = { unconfirmed: ["требует подтверждения", "warn"], confirmed: ["подтверждён", "ok"], closed: ["исполнен", "muted"], cancelled: ["отменён", "muted"] };

export default function CaseDeadlines({ caseData, readOnly }: CaseTabProps) {
  const list = useAsync(() => api.get(`/cases/${caseData.id}/deadlines`), [caseData.id]);
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="col">
      {!readOnly ? <div><Button variant="primary" onClick={() => setEdit({})}>Зарегистрировать контрольное событие</Button></div> : null}
      {list.data ? <DataTable rows={list.data} onRow={(r) => setEdit(r)} columns={[
        { key: "title", label: "Срок", render: (r: any) => <>{r.title}<div className="small muted">{r.calculation?.basis}</div></> },
        { key: "start", label: "Исходная дата", render: (r: any) => fmtDateTime(r.start_at) },
        { key: "due", label: "Истекает", sort: (r: any) => r.due_at ?? "9999", render: (r: any) => r.due_at ? <>{fmtDateTime(r.due_at)} {(() => { const d = daysLeft(r.due_at)!; return d < 0 ? <Badge tone="danger">просрочен</Badge> : <Badge tone={d <= r.notify_days_before ? "warn" : "info"}>{d} дн.</Badge>; })()}</> : <Badge tone="muted">течение приостановлено</Badge> },
        { key: "status", label: "Статус", render: (r: any) => <Badge tone={ST[r.status][1]}>{ST[r.status][0]}</Badge> },
      ]} empty="Сроки не зарегистрированы" initialSort="due" /> : <Loading error={list.error} />}
      {edit ? <DeadlineModal caseId={caseData.id} value={edit} readOnly={readOnly} onClose={() => { setEdit(null); list.reload(); }} /> : null}
    </div>
  );
}

function DeadlineModal({ caseId, value, readOnly, onClose }: { caseId: string; value: any; readOnly: boolean; onClose: () => void }) {
  const toast = useToast();
  const rules = useAsync(() => api.get("/deadlines/rules"), []);
  const hist = useAsync(() => value.id ? api.get(`/deadlines/${value.id}/history`) : Promise.resolve([]), [value.id]);
  const [v, setV] = useState<any>({
    rule_code: value.rule_code ?? "preliminary_investigation", title: value.title ?? "", start_at: (value.start_at ?? new Date().toISOString()).slice(0, 16),
    params: value.params ?? {}, adjustments: value.adjustments ?? [], source_note: value.source_note ?? "", notify_days_before: value.notify_days_before ?? 3,
  });
  const [preview, setPreview] = useState<any | null>(value.calculation ?? null);
  const [adj, setAdj] = useState<any>({ type: "extension" });
  const rule = rules.data?.find((r: any) => r.code === v.rule_code);

  async function calc(next = v) {
    try {
      setPreview(await api.post("/deadlines/preview", { ...next, title: next.title || null }));
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  async function save(extra: any = {}) {
    try {
      const body = { ...v, title: v.title || null, ...extra };
      if (value.id) await api.patch(`/deadlines/${value.id}`, body);
      else await api.post(`/cases/${caseId}/deadlines`, body);
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  function addAdj() {
    const next = { ...v, adjustments: [...v.adjustments, adj] };
    setV(next);
    setAdj({ type: "extension" });
    calc(next);
  }
  return (
    <Modal wide title={value.id ? value.title : "Новый контрольный срок"} onClose={onClose} footer={!readOnly ? (
      <>{value.id ? <><Button onClick={() => save({ status: "closed" })}>Отметить исполненным</Button><Button onClick={() => save({ status: "cancelled" })}>Отменить</Button></> : null}
        <span className="spacer" />
        <Button onClick={() => save()}>Сохранить</Button>
        <Button variant="primary" onClick={() => save({ status: "confirmed" })}>Сохранить и подтвердить расчёт</Button></>) : undefined}>
      <div className="form-grid">
        <Field label="Правило расчёта" wide>
          <select value={v.rule_code} disabled={readOnly || !!value.id} onChange={(e) => { const n = { ...v, rule_code: e.target.value }; setV(n); calc(n); }}>
            {rules.data?.map((r: any) => <option key={r.code} value={r.code}>{r.title} ({r.basis})</option>)}
          </select>
        </Field>
        {rule?.note ? <div className="notice small wide">{rule.note}</div> : null}
        <Field label="Наименование"><input disabled={readOnly} value={v.title} placeholder={rule?.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Исходная дата и время"><input type="datetime-local" disabled={readOnly} value={v.start_at} onChange={(e) => { const n = { ...v, start_at: e.target.value }; setV(n); calc(n); }} /></Field>
        {v.rule_code === "custom" ? (
          <>
            <Field label="Величина"><input type="number" value={v.params.amount ?? ""} onChange={(e) => setV({ ...v, params: { ...v.params, amount: Number(e.target.value) } })} /></Field>
            <Field label="Единица"><select value={v.params.unit ?? "days"} onChange={(e) => setV({ ...v, params: { ...v.params, unit: e.target.value } })}><option value="hours">часы</option><option value="days">сутки</option><option value="months">месяцы</option></select></Field>
          </>
        ) : null}
        <Field label="Включать день начала течения срока">
          <select disabled={readOnly} value={String(v.params.include_start_day ?? rule?.include_start_day ?? false)} onChange={(e) => { const n = { ...v, params: { ...v.params, include_start_day: e.target.value === "true" } }; setV(n); calc(n); }}>
            <option value="false">нет (ч. 1 ст. 128 УПК РФ)</option><option value="true">да</option>
          </select>
        </Field>
        <Field label="Уведомлять за (дней)"><input type="number" min={0} disabled={readOnly} value={v.notify_days_before} onChange={(e) => setV({ ...v, notify_days_before: Number(e.target.value) })} /></Field>
        <Field label="Источник расчёта / примечание" wide><textarea disabled={readOnly} value={v.source_note} onChange={(e) => setV({ ...v, source_note: e.target.value })} /></Field>
      </div>
      <h3 style={{ marginTop: 12 }}>Продление и приостановление</h3>
      {v.adjustments.map((a: any, i: number) => (
        <div key={i} className="row small">
          <span className="grow">{a.type === "extension" ? `Продление ${a.new_due ? "до " + a.new_due : a.months ? "общий срок " + a.months + " мес." : "на " + a.days + " сут."}` : `Приостановление ${a.from} — ${a.to ?? "по настоящее время"}`}{a.basis ? ` (${a.basis})` : ""}</span>
          {!readOnly ? <Button size="sm" onClick={() => { const n = { ...v, adjustments: v.adjustments.filter((_: any, j: number) => j !== i) }; setV(n); calc(n); }}>Удалить</Button> : null}
        </div>
      ))}
      {!readOnly ? (
        <div className="row" style={{ marginTop: 6 }}>
          <select style={{ maxWidth: 170 }} value={adj.type} onChange={(e) => setAdj({ type: e.target.value })}><option value="extension">продление</option><option value="suspension">приостановление</option></select>
          {adj.type === "extension" ? <><input style={{ maxWidth: 170 }} type="date" title="Продлить до" onChange={(e) => setAdj({ ...adj, new_due: e.target.value })} /><input style={{ maxWidth: 110 }} type="number" placeholder="или мес." onChange={(e) => setAdj({ ...adj, months: Number(e.target.value) || undefined })} /></>
            : <><input style={{ maxWidth: 170 }} type="date" title="с" onChange={(e) => setAdj({ ...adj, from: e.target.value })} /><input style={{ maxWidth: 170 }} type="date" title="по" onChange={(e) => setAdj({ ...adj, to: e.target.value || undefined })} /></>}
          <input className="grow" placeholder="Основание (решение, дата)" onChange={(e) => setAdj({ ...adj, basis: e.target.value })} />
          <Button size="sm" onClick={addAdj}>Добавить</Button>
        </div>) : null}
      <h3 style={{ marginTop: 12 }}>Расчёт</h3>
      {preview ? (
        <div className="card">
          <div className="small muted">Норма: {preview.basis}</div>
          <ol className="small">{preview.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
          <div className="notice warn small">Автоматический расчёт подлежит проверке и подтверждению пользователем, в особенности при наличии специальных обстоятельств.</div>
        </div>
      ) : <Button onClick={() => calc()}>Рассчитать</Button>}
      {value.id && hist.data?.length ? <><h3 style={{ marginTop: 12 }}>Журнал изменения срока</h3>
        {hist.data.map((h: any, i: number) => <div key={i} className="small">{fmtDateTime(h.changed_at)} · {h.changed_by ?? "—"}: {h.note ?? ""} {h.before?.due_at !== h.after?.due_at ? `срок ${fmtDateTime(h.before?.due_at)} → ${fmtDateTime(h.after?.due_at)}` : ""} {h.before?.status !== h.after?.status ? `статус ${h.before?.status ?? "—"} → ${h.after?.status}` : ""}</div>)}</> : null}
    </Modal>
  );
}
