import { useState } from "react";
import { api, q } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, DataTable, Field, Loading, Modal, useAsync, useToast } from "../../components/ui";
import type { CaseTabProps } from "../CaseView";

export default function Participants({ caseData, readOnly }: CaseTabProps) {
  const [archived, setArchived] = useState(false);
  const list = useAsync(() => api.get(`/cases/${caseData.id}/participants${q({ archived })}`), [caseData.id, archived]);
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="col">
      <div className="row">
        {!readOnly ? <Button variant="primary" onClick={() => setEdit({ role: "victim", kind: "person", data: {} })}>Добавить участника</Button> : null}
        <label className="row small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Показать архивные</label>
      </div>
      {list.data ? (
        <DataTable rows={list.data} onRow={(r) => setEdit(r)} initialSort="role" columns={[
          { key: "role", label: "Процессуальное положение", sort: (r: any) => r.role_label, render: (r: any) => <Badge>{r.role_label}</Badge> },
          { key: "name", label: "ФИО / наименование", sort: (r: any) => r.display_name, render: (r: any) => <>{r.display_name}{r.is_archived ? <> <Badge tone="muted">архив</Badge></> : null}</> },
          { key: "birth", label: "Дата рождения", render: (r: any) => fmtDate(r.data.birth_date) },
          { key: "addr", label: "Адрес", render: (r: any) => r.data.address_actual || r.data.address_registration || "—" },
          { key: "phone", label: "Телефон", render: (r: any) => r.data.phone || "—" },
        ]} empty="Участники не добавлены" />
      ) : <Loading error={list.error} />}
      {edit ? <ParticipantModal caseId={caseData.id} value={edit} readOnly={readOnly} participants={list.data ?? []}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} /> : null}
    </div>
  );
}

function ParticipantModal({ caseId, value, readOnly, participants, onClose, onSaved }: any) {
  const { meta } = useSession();
  const toast = useToast();
  const [v, setV] = useState<any>({ ...value, data: { ...(value.data ?? {}) } });
  const [busy, setBusy] = useState(false);
  const schema: any[] = meta.participants?.schemas?.[v.role]?.[v.kind] ?? [];
  const set = (k: string, val: any) => setV({ ...v, [k]: val });
  const setD = (k: string, val: any) => setV({ ...v, data: { ...v.data, [k]: val } });
  async function save() {
    setBusy(true);
    try {
      const body = { role: v.role, kind: v.kind, last_name: v.last_name, first_name: v.first_name, patronymic: v.patronymic, org_name: v.org_name, data: v.data };
      if (v.id) await api.patch(`/participants/${v.id}`, body);
      else await api.post(`/cases/${caseId}/participants`, body);
      toast("ok", "Сведения об участнике сохранены");
      onSaved();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    await api.patch(`/participants/${v.id}`, { is_archived: !v.is_archived });
    onSaved();
  }
  return (
    <Modal wide title={v.id ? v.display_name : "Новый участник"} onClose={onClose} footer={!readOnly ? (
      <>{v.id ? <Button onClick={archive}>{v.is_archived ? "Вернуть из архива" : "Архивировать"}</Button> : null}<span className="spacer" />
        <Button onClick={onClose}>Отмена</Button><Button variant="primary" busy={busy} onClick={save}>Сохранить</Button></>) : undefined}>
      <div className="form-grid">
        <Field label="Процессуальное положение" required>
          <select value={v.role} disabled={readOnly} onChange={(e) => set("role", e.target.value)}>
            {meta.participants?.roles.map((r: any) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Вид лица">
          <select value={v.kind} disabled={readOnly || !!v.id} onChange={(e) => set("kind", e.target.value)}>
            <option value="person">Физическое лицо</option>
            <option value="organization">Организация</option>
          </select>
        </Field>
        {v.kind === "person" ? (
          <>
            <Field label="Фамилия" required><input disabled={readOnly} value={v.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></Field>
            <Field label="Имя"><input disabled={readOnly} value={v.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></Field>
            <Field label="Отчество"><input disabled={readOnly} value={v.patronymic ?? ""} onChange={(e) => set("patronymic", e.target.value)} /></Field>
          </>
        ) : (
          <Field label="Наименование организации" required wide><input disabled={readOnly} value={v.org_name ?? ""} onChange={(e) => set("org_name", e.target.value)} /></Field>
        )}
        {schema.map((f) => (
          <Field key={f.key} label={f.label} wide={f.type === "textarea"}>
            {f.type === "textarea" ? <textarea disabled={readOnly} value={v.data[f.key] ?? ""} onChange={(e) => setD(f.key, e.target.value)} />
              : f.type === "participant" ? (
                <select disabled={readOnly} value={v.data[f.key] ?? ""} onChange={(e) => setD(f.key, e.target.value)}>
                  <option value="">—</option>
                  {participants.filter((p: any) => p.id !== v.id).map((p: any) => <option key={p.id} value={p.id}>{p.display_name} ({p.role_label})</option>)}
                </select>)
              : <input disabled={readOnly} type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"} value={v.data[f.key] ?? ""} onChange={(e) => setD(f.key, e.target.value)} />}
          </Field>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>Обязательность сведений определяется видом формируемого документа; недостающие данные будут отмечены в проекте.</p>
    </Modal>
  );
}
