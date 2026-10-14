import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { DataTable, Loading, useAsync } from "../../components/ui";
import type { CaseTabProps } from "../CaseView";

const ENT: Record<string, string> = { case: "Карточка дела", participant: "Участник", fact: "Факт", deadline: "Срок", discrepancy: "Расхождение", event: "Событие", file: "Материал" };

function changes(before: any, after: any): string {
  if (!before) return "создание записи";
  if (!after) return "удаление";
  const keys = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return keys.map((k) => `${k}: ${JSON.stringify(before[k]) ?? "—"} → ${JSON.stringify(after[k]) ?? "—"}`).join("; ");
}

export default function History({ caseData }: CaseTabProps) {
  const h = useAsync(() => api.get(`/cases/${caseData.id}/history`), [caseData.id]);
  if (!h.data) return <Loading error={h.error} />;
  return <DataTable rows={h.data} columns={[
    { key: "at", label: "Дата", render: (r: any) => <span className="nowrap">{fmtDateTime(r.changed_at)}</span> },
    { key: "who", label: "Пользователь", render: (r: any) => r.changed_by ?? "—" },
    { key: "ent", label: "Объект", render: (r: any) => ENT[r.entity_type] ?? r.entity_type },
    { key: "what", label: "Изменения", render: (r: any) => <span className="small">{r.note ? `${r.note}. ` : ""}{changes(r.before, r.after)}</span> },
  ]} empty="Изменений нет" />;
}
