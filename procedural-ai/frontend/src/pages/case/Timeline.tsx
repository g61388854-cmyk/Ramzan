import { useState } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtDateTime } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, Empty, Field, Loading, Modal, useAsync, useToast } from "../../components/ui";
import SourceViewer from "../SourceViewer";
import type { CaseTabProps } from "../CaseView";

export default function Timeline({ caseData, readOnly }: CaseTabProps) {
  const { meta } = useSession();
  const [extracted, setExtracted] = useState(true);
  const tl = useAsync(() => api.get(`/cases/${caseData.id}/timeline?include_extracted=${extracted}`), [caseData.id, extracted]);
  const [adding, setAdding] = useState(false);
  const [src, setSrc] = useState<any | null>(null);
  const types = Object.fromEntries((meta.stages?.event_types ?? []).map((t: any) => [t.code, t.label]));
  return (
    <div className="col">
      <div className="row">
        {!readOnly ? <Button variant="primary" onClick={() => setAdding(true)}>Зарегистрировать событие</Button> : null}
        <label className="row small"><input type="checkbox" checked={extracted} onChange={(e) => setExtracted(e.target.checked)} /> Показывать даты, извлечённые из материалов</label>
      </div>
      {!tl.data ? <Loading error={tl.error} /> : tl.data.length === 0 ? <Empty>Событий нет</Empty> : (
        <div className="timeline card">
          {tl.data.map((e: any) => (
            <div key={e.kind + e.id} className={`item ${e.machine ? "machine" : ""}`}>
              <div className="row small"><b>{e.kind === "event" ? fmtDateTime(e.date) : fmtDate(e.date)}</b>
                {e.machine ? <Badge tone="machine">из материалов, не проверено</Badge> : <Badge>{types[e.event_type] ?? e.event_type}</Badge>}
                {e.machine ? <Button size="sm" onClick={() => setSrc(e)}>Источник</Button> : null}</div>
              <div>{e.title}</div>
              {e.description ? <div className="small muted">{e.description}</div> : null}
            </div>
          ))}
        </div>
      )}
      {adding ? <AddEvent caseId={caseData.id} types={meta.stages?.event_types ?? []} onClose={() => { setAdding(false); tl.reload(); }} /> : null}
      {src ? <SourceViewer fileId={src.file_id} fragmentId={src.fragment_id} onClose={() => setSrc(null)} /> : null}
    </div>
  );
}

function AddEvent({ caseId, types, onClose }: { caseId: string; types: any[]; onClose: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<any>({ event_type: "action", occurred_at: new Date().toISOString().slice(0, 16), title: "" });
  async function save() {
    try {
      await api.post(`/cases/${caseId}/events`, v);
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <Modal title="Событие процессуальной истории" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save} disabled={!v.title}>Сохранить</Button></>}>
      <div className="col">
        <Field label="Тип"><select value={v.event_type} onChange={(e) => setV({ ...v, event_type: e.target.value })}>{types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
        <Field label="Дата и время"><input type="datetime-local" value={v.occurred_at} onChange={(e) => setV({ ...v, occurred_at: e.target.value })} /></Field>
        <Field label="Наименование" required><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Описание"><textarea value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
