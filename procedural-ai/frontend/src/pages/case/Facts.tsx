import { useState } from "react";
import { api, q } from "../../lib/api";
import { fmtDateTime, FACT_STATUS } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, DataTable, Field, Loading, Modal, useAsync, useToast } from "../../components/ui";
import SourceViewer from "../SourceViewer";
import type { CaseTabProps } from "../CaseView";

export default function Facts({ caseData, readOnly, reload }: CaseTabProps) {
  const { meta } = useSession();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const list = useAsync(() => api.get(`/cases/${caseData.id}/facts${q({ status, fact_type: type })}`), [caseData.id, status, type]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const labels = meta.files?.entity_labels ?? {};
  const toast = useToast();

  async function setFactStatus(id: string, s: string) {
    try {
      await api.patch(`/facts/${id}`, { status: s });
      list.reload();
      reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <div className="col">
      <div className="notice info small">Карточки фактов сформированы автоматически либо внесены вручную. Машинно извлечённые сведения не считаются достоверными до проверки пользователем; в документы рекомендуется подставлять только подтверждённые факты.</div>
      <div className="row">
        <select style={{ maxWidth: 220 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
          <option value="">Все статусы</option>
          {Object.entries(FACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
        <select style={{ maxWidth: 260 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип">
          <option value="">Все типы сведений</option>
          {Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
        </select>
        <span className="spacer" />
        {!readOnly ? <Button onClick={() => setAdding(true)}>Добавить факт вручную</Button> : null}
      </div>
      {list.data ? (
        <DataTable rows={list.data} onRow={(r: any) => setOpen(r.id)} columns={[
          { key: "type", label: "Тип", sort: (r: any) => r.label ?? r.fact_type, render: (r: any) => r.label ?? r.fact_type },
          { key: "content", label: "Содержание", sort: (r: any) => r.content, render: (r: any) => <>{r.content}{r.edited_manually ? <> <Badge tone="info">изменён вручную</Badge></> : null}</> },
          { key: "src", label: "Источники", render: (r: any) => r.sources.map((s: any) => s.source_code).filter(Boolean).join(", ") || "—" },
          { key: "origin", label: "Происхождение", render: (r: any) => r.machine_generated ? <Badge tone="machine">извлечено автоматически</Badge> : <Badge>внесено вручную</Badge> },
          { key: "status", label: "Статус", sort: (r: any) => r.status, render: (r: any) => <Badge tone={FACT_STATUS[r.status][1]}>{FACT_STATUS[r.status][0]}</Badge> },
          { key: "act", label: "", render: (r: any) => !readOnly ? (
            <div className="row" onClick={(e) => e.stopPropagation()}>
              {r.status !== "confirmed" ? <Button size="sm" onClick={() => setFactStatus(r.id, "confirmed")}>Подтвердить</Button> : null}
              {r.status !== "rejected" ? <Button size="sm" onClick={() => setFactStatus(r.id, "rejected")}>Отклонить</Button> : null}
            </div>) : null },
        ]} empty="Факты отсутствуют. Загрузите материалы или добавьте факт вручную." />
      ) : <Loading error={list.error} />}
      {open ? <FactCard id={open} readOnly={readOnly} onClose={() => { setOpen(null); list.reload(); }} /> : null}
      {adding ? <AddFact caseId={caseData.id} labels={labels} onClose={() => { setAdding(false); list.reload(); }} /> : null}
    </div>
  );
}

function FactCard({ id, readOnly, onClose }: { id: string; readOnly: boolean; onClose: () => void }) {
  const toast = useToast();
  const f = useAsync(() => api.get(`/facts/${id}`), [id]);
  const [content, setContent] = useState<string | null>(null);
  const [src, setSrc] = useState<any | null>(null);
  async function save(body: any) {
    try {
      await api.patch(`/facts/${id}`, body);
      f.reload();
      setContent(null);
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  const d = f.data;
  return (
    <Modal wide title="Карточка факта" onClose={onClose}>
      {!d ? <Loading error={f.error} /> : (
        <div className="col">
          <div className="row">
            <Badge tone={FACT_STATUS[d.status][1]}>{FACT_STATUS[d.status][0]}</Badge>
            {d.machine_generated ? <Badge tone="machine">машинно сформированные данные</Badge> : <Badge>внесено вручную</Badge>}
            {d.confidence != null ? <span className="small muted">оценка OCR-движка: {(d.confidence * 100).toFixed(0)}% — не является доказательством достоверности</span> : null}
          </div>
          <Field label={d.label ?? d.fact_type}>
            {content === null ? <div className="row"><b className="grow">{d.content}</b>{!readOnly ? <Button size="sm" onClick={() => setContent(d.content)}>Изменить</Button> : null}</div>
              : <div className="row"><input className="grow" value={content} onChange={(e) => setContent(e.target.value)} /><Button size="sm" variant="primary" onClick={() => save({ content })}>Сохранить</Button></div>}
          </Field>
          {d.edited_manually ? <div className="small muted">Исходное извлечённое значение: «{d.original_content}»</div> : null}
          {d.normalized ? <div className="small muted">Нормализованное значение: <span className="mono">{d.normalized}</span></div> : null}
          <div className="small muted">Дата извлечения: {fmtDateTime(d.created_at)}{d.verified_at ? `; проверено ${fmtDateTime(d.verified_at)}` : ""}</div>
          <h3>Источники</h3>
          {d.sources.map((s: any, i: number) => (
            <div key={i} className="card" style={{ padding: 8 }}>
              <div className="row small"><b>{s.source_code}</b><span>{s.file_name}</span>{s.page ? <span>стр. {s.page}</span> : null}{s.paragraph ? <span>абз. {s.paragraph}</span> : null}
                <span className="spacer" /><Button size="sm" onClick={() => setSrc(s)}>Открыть источник</Button></div>
              <div className="small" style={{ marginTop: 4 }}>{s.quote}</div>
            </div>
          ))}
          {!d.sources.length ? <div className="muted">Источник не указан</div> : null}
          {d.history?.length ? <><h3>История изменений</h3>{d.history.map((h: any, i: number) => (
            <div key={i} className="small">{fmtDateTime(h.changed_at)}: {JSON.stringify(h.before)} → {JSON.stringify(h.after)}</div>))}</> : null}
          {!readOnly ? (
            <div className="row">
              <Button variant="primary" onClick={() => save({ status: "confirmed" })}>Подтвердить</Button>
              <Button onClick={() => save({ status: "rejected" })}>Отклонить</Button>
              <Button onClick={() => save({ status: "unverified" })}>Снять отметку</Button>
            </div>) : null}
        </div>
      )}
      {src ? <SourceViewer fileId={src.file_id} fragmentId={src.fragment_id} range={src.char_start != null ? [src.char_start, src.char_end] : null} onClose={() => setSrc(null)} /> : null}
    </Modal>
  );
}

function AddFact({ caseId, labels, onClose }: { caseId: string; labels: Record<string, string>; onClose: () => void }) {
  const toast = useToast();
  const files = useAsync(() => api.get(`/cases/${caseId}/files`), [caseId]);
  const [v, setV] = useState<any>({ fact_type: "testimony", content: "" });
  async function save() {
    try {
      await api.post(`/cases/${caseId}/facts`, { ...v, file_id: v.file_id || null });
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <Modal title="Новый факт" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save} disabled={!v.content}>Добавить</Button></>}>
      <div className="col">
        <Field label="Тип сведений"><select value={v.fact_type} onChange={(e) => setV({ ...v, fact_type: e.target.value })}>{Object.entries(labels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Содержание" required><textarea value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} /></Field>
        <Field label="Подтверждающий источник"><select value={v.file_id ?? ""} onChange={(e) => setV({ ...v, file_id: e.target.value })}>
          <option value="">— без источника (требует подтверждения) —</option>
          {files.data?.map((f: any) => <option key={f.id} value={f.id}>{f.source_code} · {f.original_name}</option>)}
        </select></Field>
        <Field label="Цитата / указание на место в источнике"><textarea value={v.quote ?? ""} onChange={(e) => setV({ ...v, quote: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
