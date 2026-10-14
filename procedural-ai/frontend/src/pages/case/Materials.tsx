import { DragEvent, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime, fmtSize, FILE_STATUS } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, DataTable, Loading, useAsync, useToast } from "../../components/ui";
import SourceViewer from "../SourceViewer";
import type { CaseTabProps } from "../CaseView";

export default function Materials({ caseData, readOnly, reload, query }: CaseTabProps) {
  const { meta } = useSession();
  const toast = useToast();
  const [archived, setArchived] = useState(false);
  const files = useAsync(() => api.get(`/cases/${caseData.id}/files${archived ? "?archived=true" : ""}`), [caseData.id, archived]);
  const [category, setCategory] = useState("other");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(query.get("file"));

  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    for (const f of Array.from(list)) {
      const form = new FormData();
      form.append("file", f);
      form.append("category", category);
      try {
        const r = await api.upload(`/cases/${caseData.id}/files`, form);
        toast("ok", `${r.file.source_code}: «${r.file.original_name}» загружен, обработка запущена`);
        r.warnings?.forEach((w: string) => toast("info", w));
        pollTask(r.task.id);
      } catch (e: any) {
        toast("error", `«${f.name}»: ${e.message}`);
      }
    }
    setBusy(false);
    files.reload();
  }
  function pollTask(id: string) {
    const t = setInterval(async () => {
      try {
        const task = await api.get(`/tasks/${id}`);
        if (["done", "failed", "interrupted"].includes(task.status)) {
          clearInterval(t);
          files.reload();
          reload();
          if (task.status !== "done") toast("error", `Обработка завершилась ошибкой: ${task.error ?? ""}`);
        }
      } catch {
        clearInterval(t);
      }
    }, 1500);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (!readOnly) uploadFiles(e.dataTransfer.files);
  }
  async function act(f: any, kind: "reprocess" | "archive") {
    try {
      if (kind === "reprocess") {
        const t = await api.post(`/files/${f.id}/reprocess`);
        pollTask(t.id);
      } else await api.patch(`/files/${f.id}`, { is_archived: !f.is_archived });
      files.reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  const cats = meta.files?.categories ?? [];
  const kinds = meta.files?.doc_kind_labels ?? {};
  return (
    <div className="col">
      {!readOnly ? (
        <div className={`dropzone ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <div className="row" style={{ justifyContent: "center" }}>
            <span>Перетащите файлы сюда или</span>
            <label className="btn primary">Выбрать файлы<input type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)} /></label>
            <select style={{ maxWidth: 240 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория материала">
              {cats.map((c: any) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            {busy ? <span>Загрузка…</span> : null}
          </div>
          <div className="small" style={{ marginTop: 6 }}>Допустимые форматы: {(meta.files?.allowed_extensions ?? []).join(", ")}; до {meta.files?.max_upload_mb} МБ. Файлы шифруются при хранении.</div>
        </div>
      ) : null}
      <label className="row small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Показать архивные</label>
      {files.data ? (
        <DataTable rows={files.data} onRow={(r: any) => setView(r.id)} initialSort="code" columns={[
          { key: "code", label: "Ид.", sort: (r: any) => r.source_code, render: (r: any) => <span className="mono">{r.source_code}</span> },
          { key: "name", label: "Файл", sort: (r: any) => r.original_name, render: (r: any) => <>{r.original_name}<div className="small muted">{fmtSize(r.size)}{r.page_count ? ` · ${r.page_count} стр.` : ""}</div></> },
          { key: "cat", label: "Категория", render: (r: any) => cats.find((c: any) => c.code === r.category)?.label ?? r.category },
          { key: "kind", label: "Тип (определён)", render: (r: any) => r.detected_kind ? <>{kinds[r.detected_kind] ?? r.detected_kind} <Badge tone="machine">авто</Badge></> : <span className="muted">—</span> },
          { key: "status", label: "Обработка", render: (r: any) => <><Badge tone={FILE_STATUS[r.status]?.[1]}>{FILE_STATUS[r.status]?.[0] ?? r.status}</Badge>{r.machine_generated ? <> <Badge tone="machine">OCR/ASR</Badge></> : null}{r.error ? <div className="small" style={{ color: "var(--danger)" }}>{r.error}</div> : null}</> },
          { key: "date", label: "Загружен", sort: (r: any) => r.uploaded_at, render: (r: any) => fmtDateTime(r.uploaded_at) },
          { key: "act", label: "", render: (r: any) => !readOnly ? (
            <div className="row" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" onClick={() => act(r, "reprocess")}>Повторить</Button>
              <Button size="sm" onClick={() => act(r, "archive")}>{r.is_archived ? "Вернуть" : "В архив"}</Button>
            </div>) : null },
        ]} empty="Материалы не загружены" />
      ) : <Loading error={files.error} />}
      {view ? <SourceViewer fileId={view} onClose={() => setView(null)} /> : null}
    </div>
  );
}
