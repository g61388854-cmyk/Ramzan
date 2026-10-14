import { useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Empty, Loading, useAsync, useToast } from "../../components/ui";
import SourceViewer from "../SourceViewer";
import type { CaseTabProps } from "../CaseView";

const KIND: Record<string, string> = {
  case_number_card: "Номер дела: карточка и материалы", case_number: "Различные номера дела", person_name: "Написание ФИО",
  birth_date: "Даты рождения", birth_date_card: "Дата рождения: карточка и материалы", incident_date: "Даты события",
  money: "Суммы ущерба", document_number: "Номера документов", time_sequence: "Временная последовательность",
  missing_document: "Отсутствующий документ",
};
const ST: Record<string, [string, string]> = { open: ["не рассмотрено", "warn"], resolved: ["рассмотрено", "ok"], dismissed: ["не подтвердилось", "muted"], stale: ["не выявляется после изменения материалов", "muted"] };

export default function Discrepancies({ caseData, readOnly, reload }: CaseTabProps) {
  const toast = useToast();
  const list = useAsync(() => api.get(`/cases/${caseData.id}/discrepancies`), [caseData.id]);
  const [src, setSrc] = useState<any | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  async function setStatus(id: string, status: string) {
    try {
      await api.patch(`/discrepancies/${id}`, { status, resolution_note: notes[id] ?? null });
      list.reload();
      reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  async function refresh() {
    const r = await api.post(`/cases/${caseData.id}/discrepancies/refresh`);
    toast("info", `Выявлено потенциальных расхождений: ${r.detected}`);
    list.reload();
  }
  return (
    <div className="col">
      <div className="notice info small">Перечень содержит <b>потенциальные</b> расхождения между материалами и карточкой дела. Система не устанавливает, какой из вариантов является достоверным, и не делает вывода о нарушении или недостоверности сведений.</div>
      {!readOnly ? <div><Button onClick={refresh}>Повторить поиск</Button></div> : null}
      {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <Empty>Потенциальные расхождения не выявлены</Empty> : list.data.map((d: any) => (
        <div key={d.id} className="card">
          <div className="row"><Badge tone="info">{KIND[d.kind] ?? d.kind}</Badge><Badge tone={ST[d.status]?.[1]}>{ST[d.status]?.[0] ?? d.status}</Badge></div>
          <p style={{ margin: "6px 0" }}>{d.description}</p>
          <div className="list">
            {d.items.map((it: any, i: number) => (
              <div className="item small" key={i}>
                <b className="nowrap">{it.source_code}</b>
                <span className="grow">{it.card ? <>значение в карточке: <b>{it.value}</b></> : <>«{it.value}» — <span className="muted">{it.context}</span></>}</span>
                {it.file_id ? <Button size="sm" onClick={() => setSrc(it)}>Источник</Button> : null}
              </div>
            ))}
          </div>
          {d.resolution_note ? <div className="small muted">Отметка: {d.resolution_note}</div> : null}
          {!readOnly ? (
            <div className="row" style={{ marginTop: 6 }}>
              <input className="grow" placeholder="Результат рассмотрения (например, проведён дополнительный допрос)" value={notes[d.id] ?? ""} onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })} />
              <Button size="sm" onClick={() => setStatus(d.id, "resolved")}>Рассмотрено</Button>
              <Button size="sm" onClick={() => setStatus(d.id, "dismissed")}>Не подтвердилось</Button>
              {d.status !== "open" ? <Button size="sm" onClick={() => setStatus(d.id, "open")}>Вернуть</Button> : null}
            </div>) : null}
        </div>
      ))}
      {src ? <SourceViewer fileId={src.file_id} fragmentId={src.fragment_id} onClose={() => setSrc(null)} /> : null}
    </div>
  );
}
