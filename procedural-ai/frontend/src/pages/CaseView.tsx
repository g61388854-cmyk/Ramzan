import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { Badge, Loading, Tabs, useAsync } from "../components/ui";
import General from "./case/General";
import Participants from "./case/Participants";
import Materials from "./case/Materials";
import Facts from "./case/Facts";
import Discrepancies from "./case/Discrepancies";
import Timeline from "./case/Timeline";
import Documents from "./case/Documents";
import CaseDeadlines from "./case/CaseDeadlines";
import History from "./case/History";

export default function CaseView({ id, tab, query }: { id: string; tab: string; query: URLSearchParams }) {
  const c = useAsync(() => api.get(`/cases/${id}`), [id]);
  if (!c.data) return <Loading error={c.error} />;
  const cs = c.data;
  const ro = cs.access !== "write";
  const counts = cs.counts;
  const tabs = [
    { key: "general", label: "Общие сведения", count: cs.missing_fields.length || null, tone: "warn" },
    { key: "participants", label: "Участники", count: counts.participants },
    { key: "files", label: "Материалы", count: counts.files },
    { key: "facts", label: "Факты", count: counts.facts_unverified || null, tone: "warn" },
    { key: "discrepancies", label: "Расхождения", count: counts.discrepancies_open || null, tone: "danger" },
    { key: "timeline", label: "Хронология" },
    { key: "documents", label: "Документы", count: counts.documents },
    { key: "deadlines", label: "Сроки", count: counts.deadlines_active },
    { key: "history", label: "История изменений" },
  ];
  const props = { caseData: cs, readOnly: ro, reload: c.reload, query };
  return (
    <div>
      <div className="page-head">
        <div className="grow">
          <div className="small muted"><a href="#/cases">Уголовные дела</a> / {cs.reg_id}</div>
          <h1>Уголовное дело {cs.case_number ? `№ ${cs.case_number}` : <span className="muted">(номер не присвоен)</span>}</h1>
          <div className="row small">
            <Badge>{cs.stage_label}</Badge>
            <span className="muted">{cs.qualification || "квалификация не указана"}</span>
            {ro ? <Badge tone="muted">только чтение</Badge> : null}
            {cs.is_archived ? <Badge tone="muted">архив</Badge> : null}
          </div>
        </div>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={(k) => navigate(`/cases/${id}?tab=${k}`)} />
      {tab === "general" && <General {...props} />}
      {tab === "participants" && <Participants {...props} />}
      {tab === "files" && <Materials {...props} />}
      {tab === "facts" && <Facts {...props} />}
      {tab === "discrepancies" && <Discrepancies {...props} />}
      {tab === "timeline" && <Timeline {...props} />}
      {tab === "documents" && <Documents {...props} />}
      {tab === "deadlines" && <CaseDeadlines {...props} />}
      {tab === "history" && <History {...props} />}
    </div>
  );
}

export type CaseTabProps = { caseData: any; readOnly: boolean; reload: () => void; query: URLSearchParams };
