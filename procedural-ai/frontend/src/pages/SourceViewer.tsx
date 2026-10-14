import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { FILE_STATUS } from "../lib/format";
import { Badge, Button, Loading, Modal, useAsync } from "../components/ui";

// Просмотр исходного материала по фрагментам с подсветкой извлечённых сущностей
export default function SourceViewer({ fileId, fragmentId, range, onClose }: { fileId: string; fragmentId?: string | null; range?: [number, number] | null; onClose: () => void }) {
  const data = useAsync(() => api.get(`/files/${fileId}/fragments`), [fileId]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (data.data && fragmentId) ref.current?.querySelector(`[data-frag="${fragmentId}"]`)?.scrollIntoView({ block: "center" });
  }, [data.data, fragmentId]);
  const f = data.data?.file;
  return (
    <Modal wide title={f ? `${f.source_code} · ${f.original_name}` : "Источник"} onClose={onClose}
      footer={f ? <Button onClick={() => api.download("GET", `/files/${f.id}/download`, f.original_name)}>Скачать оригинал</Button> : undefined}>
      {!data.data ? <Loading error={data.error} /> : (
        <div ref={ref}>
          <div className="row small" style={{ marginBottom: 8 }}>
            <Badge tone={FILE_STATUS[f.status]?.[1]}>{FILE_STATUS[f.status]?.[0]}</Badge>
            {f.machine_generated ? <Badge tone="machine">машинно распознанный текст</Badge> : null}
            {f.page_count ? <span className="muted">страниц: {f.page_count}</span> : null}
            <span className="muted mono">SHA-256: {f.sha256.slice(0, 16)}…</span>
          </div>
          {f.notes ? <div className="notice warn small" style={{ marginBottom: 8 }}>{f.notes}</div> : null}
          {data.data.fragments.length === 0 ? <div className="empty">Текст не извлечён</div> : null}
          {data.data.fragments.map((fr: any) => (
            <div key={fr.id} data-frag={fr.id} className={`frag ${fr.id === fragmentId ? "focus" : ""}`}>
              <div className="small muted">{fr.page ? `стр. ${fr.page}, ` : ""}абз. {fr.paragraph ?? fr.seq}{fr.method !== "digital" ? ` · ${fr.method.toUpperCase()}` : ""}
                {fr.ocr_confidence != null ? ` · оценка движка ${(fr.ocr_confidence * 100).toFixed(0)}% (не является подтверждением достоверности)` : ""}</div>
              <div>{highlight(fr.text, fr.entities, fr.id === fragmentId ? range : null)}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function highlight(text: string, entities: any[], focus?: [number, number] | null) {
  const marks = [...entities].sort((a, b) => a.start - b.start);
  const out: any[] = [];
  let pos = 0;
  marks.forEach((m, i) => {
    if (m.start < pos) return;
    out.push(text.slice(pos, m.start));
    const isFocus = focus && m.start === focus[0] && m.end === focus[1];
    out.push(<mark key={i} className={isFocus ? "focus" : ""} title={m.type}>{text.slice(m.start, m.end)}</mark>);
    pos = m.end;
  });
  out.push(text.slice(pos));
  return out;
}
