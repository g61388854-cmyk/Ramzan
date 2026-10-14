import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Button, Field, useAsync, useToast } from "../../components/ui";
import type { CaseTabProps } from "../CaseView";

const KEY_DATES = [
  ["initiated", "Возбуждение уголовного дела"], ["accepted", "Принятие к производству"], ["charged", "Предъявление обвинения"],
  ["suspended", "Приостановление"], ["resumed", "Возобновление"], ["completed", "Окончание следственных действий"],
];

export function CaseForm({ value, onChange, disabled }: { value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const { meta } = useSession();
  const dir = useAsync(() => api.get("/users/directory"), []);
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  const inp = (k: string, label: string, opts: { type?: string; hint?: string; wide?: boolean } = {}) => (
    <Field label={label} hint={opts.hint} wide={opts.wide}>
      <input type={opts.type ?? "text"} value={value[k] ?? ""} disabled={disabled} onChange={(e) => set(k, e.target.value || null)} />
    </Field>
  );
  return (
    <div className="form-grid">
      {inp("case_number", "Номер уголовного дела", { hint: "На стадии проверки сообщения может отсутствовать" })}
      {inp("opened_at", "Дата возбуждения", { type: "date" })}
      <Field label="Стадия расследования">
        <select value={value.stage ?? "check"} disabled={disabled} onChange={(e) => set("stage", e.target.value)}>
          {meta.stages?.stages.map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
      </Field>
      {inp("investigative_body", "Орган расследования", { wide: true })}
      {inp("unit", "Подразделение")}
      <Field label="Следователь">
        <select value={value.investigator_id ?? ""} disabled={disabled} onChange={(e) => set("investigator_id", e.target.value || null)}>
          <option value="">— текущий пользователь —</option>
          {dir.data?.filter((u: any) => ["investigator", "head"].includes(u.role)).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}{u.unit ? ` (${u.unit})` : ""}</option>)}
        </select>
      </Field>
      {inp("investigator_position", "Должность, звание следователя", { wide: true, hint: "Используется в реквизитах документов" })}
      {inp("head_position", "Должность руководителя следственного органа")}
      {inp("head_name", "Руководитель (фамилия, инициалы)")}
      {inp("city", "Место (населённый пункт)", { hint: "Например: г. Северск" })}
      {inp("qualification", "Квалификация по УК РФ", { hint: "п., ч., ст. УК РФ" })}
      <Field label="Краткая фабула" wide>
        <textarea rows={4} value={value.fabula ?? ""} disabled={disabled} onChange={(e) => set("fabula", e.target.value || null)} />
      </Field>
      <fieldset className="field-group wide">
        <legend>Даты принятия ключевых решений</legend>
        <div className="form-grid">
          {KEY_DATES.map(([k, l]) => (
            <Field key={k} label={l}>
              <input type="date" disabled={disabled} value={value.key_dates?.[k] ?? ""}
                onChange={(e) => set("key_dates", { ...(value.key_dates ?? {}), [k]: e.target.value || undefined })} />
            </Field>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export default function General({ caseData, readOnly, reload }: CaseTabProps) {
  const toast = useToast();
  const [value, setValue] = useState<any>(caseData);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(caseData), [caseData]);
  async function save() {
    setBusy(true);
    try {
      const keys = ["case_number", "opened_at", "investigative_body", "unit", "investigator_id", "investigator_position", "head_name",
        "head_position", "city", "qualification", "fabula", "stage", "key_dates"];
      const body: any = {};
      keys.forEach((k) => { if (JSON.stringify(value[k]) !== JSON.stringify(caseData[k])) body[k] = value[k] === "" ? null : value[k]; });
      if (body.key_dates) body.key_dates = Object.fromEntries(Object.entries(body.key_dates).filter(([, v]) => v));
      await api.patch(`/cases/${caseData.id}`, body);
      toast("ok", "Карточка сохранена; изменения отражены в истории. Ранее сохранённые версии документов не изменяются.");
      reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(flag: boolean) {
    await api.patch(`/cases/${caseData.id}`, { is_archived: flag });
    reload();
  }
  return (
    <div className="col">
      {caseData.missing_fields.length ? <div className="notice warn">Не заполнены сведения, используемые в документах: {caseData.missing_fields.join(", ")}.</div> : null}
      <div className="card">
        <CaseForm value={value} onChange={setValue} disabled={readOnly} />
        {!readOnly ? (
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="primary" busy={busy} onClick={save}>Сохранить изменения</Button>
            <span className="spacer" />
            <Button onClick={() => archive(!caseData.is_archived)}>{caseData.is_archived ? "Вернуть из архива" : "Архивировать дело"}</Button>
          </div>
        ) : null}
      </div>
      <Members caseData={caseData} readOnly={readOnly} reload={reload} />
    </div>
  );
}

function Members({ caseData, readOnly, reload }: { caseData: any; readOnly: boolean; reload: () => void }) {
  const toast = useToast();
  const dir = useAsync(() => api.get("/users/directory"), []);
  const [uid, setUid] = useState("");
  const [access, setAccess] = useState("read");
  async function add() {
    try {
      await api.post(`/cases/${caseData.id}/members`, { user_id: uid, access });
      reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  async function remove(id: string) {
    try {
      await api.del(`/cases/${caseData.id}/members/${id}`);
      reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <div className="card">
      <h2>Доступ к делу</h2>
      <p className="small muted">Следователь: {caseData.investigator?.full_name ?? "—"}. Руководитель подразделения имеет доступ к делам подразделения.</p>
      <div className="list">
        {caseData.members.map((m: any) => (
          <div className="item" key={m.user_id}><span className="grow">{m.full_name}</span><span className="small muted">{m.access === "write" ? "изменение" : "чтение"}</span>
            {!readOnly ? <Button size="sm" onClick={() => remove(m.user_id)}>Отозвать</Button> : null}</div>
        ))}
      </div>
      {!readOnly ? (
        <div className="row" style={{ marginTop: 8 }}>
          <select style={{ maxWidth: 320 }} value={uid} onChange={(e) => setUid(e.target.value)} aria-label="Сотрудник">
            <option value="">— сотрудник —</option>
            {dir.data?.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select style={{ maxWidth: 160 }} value={access} onChange={(e) => setAccess(e.target.value)} aria-label="Уровень доступа">
            <option value="read">чтение</option>
            <option value="write">изменение</option>
          </select>
          <Button disabled={!uid} onClick={add}>Предоставить доступ</Button>
        </div>
      ) : null}
    </div>
  );
}
