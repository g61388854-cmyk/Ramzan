import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Badge, Button, Field, Loading, Modal, Tabs, useAsync, useToast } from "../components/ui";

export default function Catalog() {
  const { can } = useSession();
  const cat = useAsync(() => api.get("/templates"), []);
  const kits = useAsync(() => api.get("/templates/kits"), []);
  const specs = useAsync(() => api.get("/templates/specializations"), []);
  const [tab, setTab] = useState("types");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const groups = useMemo(() => {
    if (!cat.data) return [];
    const f = filter.toLowerCase();
    return cat.data.sections.map((s: any) => ({ ...s, items: cat.data.templates.filter((t: any) => t.section === s.code && (!f || t.title.toLowerCase().includes(f))) }));
  }, [cat.data, filter]);
  if (!cat.data) return <Loading error={cat.error} />;
  return (
    <div>
      <div className="page-head">
        <div className="grow"><h1>Каталог процессуальных документов</h1><div className="muted">Видов документов: {cat.data.templates.length}. Каталог расширяется файлами описания без изменения программного кода.</div></div>
        {can("templates.manage") ? <Button variant="primary" onClick={() => setImporting(true)}>Добавить вид документа (YAML)</Button> : null}
      </div>
      <Tabs active={tab} onChange={setTab} tabs={[{ key: "types", label: "Виды документов" }, { key: "kits", label: "Комплекты" }, { key: "specs", label: "Специализированные профили" }]} />
      {tab === "types" ? (
        <div className="col">
          <input style={{ maxWidth: 360 }} placeholder="Фильтр по наименованию" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {groups.map((g: any) => (
            <div key={g.code} className="card">
              <h2>{g.label} <Badge>{g.items.length}</Badge></h2>
              <div className="list">
                {g.items.map((t: any) => (
                  <div key={t.code} className="item">
                    <div className="grow"><a href="#" onClick={(e) => { e.preventDefault(); setOpen(t.code); }}>{t.title}</a>
                      <div className="small muted">{t.procedural_kind_label} · автор: {t.author_role} · версия {t.version}{t.origin === "custom" ? " · пользовательский" : ""}</div></div>
                    <div className="row">{t.requires_court ? <Badge tone="warn">суд</Badge> : null}{t.requires_head_consent ? <Badge tone="warn">согласие</Badge> : null}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {tab === "kits" ? (
        <div className="cards">{kits.data?.map((k: any) => (
          <div key={k.code} className="card"><h3>{k.title}</h3><div className="small muted">{k.description}</div>
            <ol className="small">{k.documents.map((c: string) => <li key={c}>{cat.data.templates.find((t: any) => t.code === c)?.title ?? c}</li>)}</ol></div>
        ))}</div>
      ) : null}
      {tab === "specs" ? (
        <div className="col">
          <div className="notice small">Специализированные профили дополняют существующие виды документов методическими подсказками и предупреждениями и не создают самостоятельных процессуальных полномочий.</div>
          <div className="cards">{specs.data?.map((s: any) => (
            <div key={s.code} className="card"><h3>{s.title}</h3>
              <div className="small muted">Применяется к: {s.applies_to.map((c: string) => cat.data.templates.find((t: any) => t.code === c)?.title ?? c).join("; ")}</div>
              {s.warnings.map((w: string, i: number) => <div key={i} className="small">• {w}</div>)}</div>
          ))}</div>
        </div>
      ) : null}
      {open ? <TemplateModal code={open} onClose={() => setOpen(null)} /> : null}
      {importing ? <ImportTemplate onClose={() => { setImporting(false); cat.reload(); }} /> : null}
    </div>
  );
}

function TemplateModal({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useAsync(() => api.get(`/templates/${code}`), [code]);
  return (
    <Modal wide title={t.data?.title ?? code} onClose={onClose}>
      {!t.data ? <Loading error={t.error} /> : (
        <div className="col small">
          <div>{t.data.procedural_kind_label} · автор: {t.data.author_role}{t.data.addressee ? ` · адресат: ${t.data.addressee}` : ""}</div>
          <div>Стадии: {t.data.stages.join(", ") || "любая"}; версии шаблона: {t.data.versions.map((v: any) => v.version).join(", ")}</div>
          {t.data.warnings.map((w: string, i: number) => <div key={i} className="notice warn">{w}</div>)}
          <h3>Правовые основания</h3>
          {t.data.legal_bases.length ? t.data.legal_bases.map((l: any) => <div key={l.key}><a href={`#/legal?key=${encodeURIComponent(l.key)}`}>{l.key}</a> — {l.reason}{l.mandatory === false ? " (при необходимости)" : ""}</div>) : <div className="muted">не определены</div>}
          <h3>Схема полей</h3>
          <table className="t"><thead><tr><th>Поле</th><th>Тип</th><th>Обязательность</th><th>Источник данных</th></tr></thead><tbody>
            {t.data.fields.map((f: any) => <tr key={f.key}><td>{f.label}<div className="mono muted">{f.key}</div></td><td>{f.type}{f.narrative ? " (описательное)" : ""}</td>
              <td>{f.required ? "обязательно" : "—"}{f.condition ? <div className="muted">при условии: {f.condition}</div> : null}</td><td>{f.binding ?? (f.participant_role ? `участник: ${f.participant_role}` : "—")}</td></tr>)}
          </tbody></table>
          <h3>Шаблон текста</h3>
          <pre className="mono" style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 8 }}>{t.data.body}</pre>
        </div>
      )}
    </Modal>
  );
}

function ImportTemplate({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api.upload("/templates/import", form);
      toast("ok", `Загружено: ${r.imported.map((x: any) => `${x.code} (в.${x.version})`).join(", ")}`);
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Добавление вида документа" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" busy={busy} disabled={!file} onClick={go}>Загрузить</Button></>}>
      <div className="col">
        <div className="notice small">Описание в формате YAML (см. «Документация по расширению каталога»). Перед сохранением выполняется проверка схемы и пробное формирование документа. Новая версия не изменяет ранее сформированные документы.</div>
        <Field label="Файл описания (.yaml)"><input type="file" accept=".yaml,.yml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
    </Modal>
  );
}
