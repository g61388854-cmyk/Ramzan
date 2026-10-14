import { useState } from "react";
import { api } from "../lib/api";
import { STATUS_TONE } from "../lib/format";
import { Badge, Empty, Loading, useAsync } from "../components/ui";
import SourceViewer from "./SourceViewer";

export default function Search({ q }: { q: string }) {
  const r = useAsync(() => api.get(`/search?q=${encodeURIComponent(q)}`), [q]);
  const [src, setSrc] = useState<any | null>(null);
  if (!r.data) return <Loading error={r.error} />;
  const d = r.data;
  const total = d.cases.length + d.participants.length + d.documents.length + d.fragments.length;
  return (
    <div>
      <div className="page-head"><div className="grow"><h1>Поиск: «{q}»</h1><div className="muted">Найдено: {total}. Поиск выполняется только по доступным делам.</div></div></div>
      <div className="cards">
        <div className="card"><h2>Дела</h2>{d.cases.length ? d.cases.map((c: any) => <div key={c.id}><a href={`#/cases/${c.id}`}>{c.case_number || c.reg_id}</a> <span className="small muted">{c.qualification}</span></div>) : <Empty>—</Empty>}</div>
        <div className="card"><h2>Участники</h2>{d.participants.length ? d.participants.map((p: any) => <div key={p.id}><a href={`#/cases/${p.case_id}?tab=participants`}>{p.display_name}</a></div>) : <Empty>—</Empty>}</div>
        <div className="card"><h2>Документы</h2>{d.documents.length ? d.documents.map((x: any) => <div key={x.id} className="row"><a className="grow" href={`#/documents/${x.id}`}>{x.title}</a><Badge tone={STATUS_TONE[x.status]}>{x.status_label}</Badge></div>) : <Empty>—</Empty>}</div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>Тексты материалов</h2>
        {d.fragments.length ? d.fragments.map((f: any) => (
          <div key={f.fragment_id} className="frag">
            <div className="small"><a href="#" onClick={(e) => { e.preventDefault(); setSrc(f); }}>{f.source_code} · {f.file_name}{f.page ? `, стр. ${f.page}` : ""}</a></div>
            <div className="small">…{f.snippet}…</div>
          </div>)) : <Empty>Совпадений нет</Empty>}
      </div>
      {src ? <SourceViewer fileId={src.file_id} fragmentId={src.fragment_id} onClose={() => setSrc(null)} /> : null}
    </div>
  );
}
