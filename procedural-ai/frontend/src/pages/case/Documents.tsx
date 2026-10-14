import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime, STATUS_TONE } from "../../lib/format";
import { navigate } from "../../lib/router";
import { Badge, Button, DataTable, Field, Loading, Modal, Tabs, useAsync, useToast } from "../../components/ui";
import type { CaseTabProps } from "../CaseView";

export default function Documents({ caseData, readOnly }: CaseTabProps) {
  const docs = useAsync(() => api.get(`/cases/${caseData.id}/documents`), [caseData.id]);
  const [creating, setCreating] = useState(false);
  return (
    <div className="col">
      {!readOnly ? <div><Button variant="primary" onClick={() => setCreating(true)}>Сформировать документ</Button></div> : null}
      {docs.data ? (
        <DataTable rows={docs.data} onRow={(r: any) => navigate(`/documents/${r.id}`)} columns={[
          { key: "title", label: "Документ", sort: (r: any) => r.title, render: (r: any) => <>{r.title}{r.kit_code ? <div className="small muted">в составе комплекта</div> : null}</> },
          { key: "kind", label: "Характер", render: (r: any) => r.template ? <span className="small">{r.template.author_role}{r.template.requires_court ? " · требуется судебное решение" : ""}</span> : <span className="small muted">без шаблона</span> },
          { key: "mode", label: "Способ", render: (r: any) => ({ template: "по шаблону", description: "по описанию", materials: "по материалам", kit: "комплект", manual: "вручную" } as any)[r.generation_mode] },
          { key: "ver", label: "Версия", render: (r: any) => r.latest_version?.number ?? "—" },
          { key: "check", label: "Проверка", render: (r: any) => { const s = r.latest_version?.validation_summary; return s ? <span className="small">{s.errors ? <Badge tone="danger">ошибок: {s.errors}</Badge> : <Badge tone="ok">ошибок нет</Badge>} {s.warnings ? <Badge tone="warn">предупр.: {s.warnings}</Badge> : null}</span> : "—"; } },
          { key: "status", label: "Статус", sort: (r: any) => r.status, render: (r: any) => <Badge tone={STATUS_TONE[r.status]}>{r.status_label}</Badge> },
          { key: "upd", label: "Изменён", sort: (r: any) => r.updated_at, render: (r: any) => fmtDateTime(r.updated_at) },
        ]} empty="Документы не сформированы" />
      ) : <Loading error={docs.error} />}
      {creating ? <CreateDocument caseData={caseData} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CreateDocument({ caseData, onClose }: { caseData: any; onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState("template");
  const cat = useAsync(() => api.get("/templates"), []);
  const kits = useAsync(() => api.get("/templates/kits"), []);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [sugg, setSugg] = useState<any | null>(null);
  const [title, setTitle] = useState("");

  const groups = useMemo(() => {
    if (!cat.data) return [];
    const f = filter.toLowerCase();
    return cat.data.sections.map((s: any) => ({ ...s, items: cat.data.templates.filter((t: any) => t.section === s.code && (!f || t.title.toLowerCase().includes(f) || t.keywords.some((k: string) => k.includes(f)))) }))
      .filter((g: any) => g.items.length);
  }, [cat.data, filter]);

  async function create(code: string | null, genMode: string, extra: any = {}) {
    setBusy(true);
    try {
      const d = await api.post(`/cases/${caseData.id}/documents`, { type_code: code, mode: genMode, ...extra });
      navigate(`/documents/${d.id}`);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function createKit(code: string) {
    setBusy(true);
    try {
      const r = await api.post(`/cases/${caseData.id}/kits`, { kit_code: code });
      toast("ok", `Сформировано документов: ${r.documents.length}. ${r.notice}`);
      onClose();
      navigate(`/documents/${r.documents[0].id}`);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function suggest() {
    setBusy(true);
    try {
      setSugg(await api.post(`/cases/${caseData.id}/assistant/suggest`, { text }));
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  const stageOk = (t: any) => !t.stages?.length || t.stages.includes(caseData.stage);

  return (
    <Modal wide title="Формирование документа" onClose={onClose}>
      <Tabs active={mode} onChange={setMode} tabs={[
        { key: "template", label: "По шаблону" }, { key: "description", label: "По описанию задачи" },
        { key: "materials", label: "По материалам" }, { key: "kit", label: "Комплект документов" }, { key: "manual", label: "Вручную (без шаблона)" },
      ]} />
      {mode === "template" || mode === "materials" ? (
        <div className="col">
          {mode === "materials" ? <div className="notice info small">Проект заполняется подтверждёнными фактами из загруженных материалов (для полей, связанных с фактами), сведениями карточки дела и участников. Перед формированием проверьте факты на вкладке «Факты».</div> : null}
          <input placeholder="Поиск по наименованию или ключевым словам" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Поиск вида документа" />
          {!cat.data ? <Loading error={cat.error} /> : groups.map((g: any) => (
            <div key={g.code}>
              <h3>{g.label}</h3>
              <div className="list">
                {g.items.map((t: any) => (
                  <div className="item" key={t.code}>
                    <div className="grow">
                      <div>{t.title}</div>
                      <div className="small muted">{t.procedural_kind_label} · автор: {t.author_role}{t.addressee ? ` · адресат: ${t.addressee}` : ""}</div>
                      <div className="row small">
                        {t.requires_court ? <Badge tone="warn">судебное решение</Badge> : null}
                        {t.requires_head_consent ? <Badge tone="warn">согласие руководителя</Badge> : null}
                        {!stageOk(t) ? <Badge tone="danger">не соответствует стадии дела</Badge> : null}
                      </div>
                    </div>
                    <Button size="sm" variant="primary" busy={busy} onClick={() => create(t.code, mode)}>Сформировать</Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {mode === "description" ? (
        <div className="col">
          <Field label="Опишите задачу" hint="Например: «нужно направить запрос в банк о движении средств по счёту потерпевшего»">
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div><Button variant="primary" busy={busy} disabled={text.length < 3} onClick={suggest}>Подобрать вид документа</Button></div>
          {sugg ? (
            <div className="col">
              <div className="notice small">{sugg.notice}</div>
              {sugg.suggestions.length === 0 ? <div className="empty">Подходящие виды документов не найдены. Уточните описание или выберите документ по шаблону.</div> : null}
              {sugg.suggestions.map((s: any) => (
                <div key={s.code} className="card">
                  <div className="row"><b className="grow">{s.title}</b>{!s.stage_ok ? <Badge tone="danger">не соответствует стадии</Badge> : null}
                    <Button size="sm" variant="primary" busy={busy} onClick={() => create(s.code, "description")}>Сформировать</Button></div>
                  <div className="small muted">Автор: {s.author_role}. Метод подбора: {s.method === "rules" ? "ключевые слова" : "ключевые слова и модель"}.</div>
                  {s.clarifying_questions.length ? (
                    <div className="small" style={{ marginTop: 6 }}>Потребуется уточнить ({s.clarifying_questions.length}):
                      <ul>{s.clarifying_questions.slice(0, 8).map((q: any) => <li key={q.key}>{q.question}</li>)}</ul>
                    </div>
                  ) : <div className="small">Обязательные сведения доступны из карточки дела.</div>}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {mode === "kit" ? (
        <div className="col">
          <div className="notice info small">Каждый документ комплекта формируется отдельно и требует самостоятельной проверки.</div>
          {!kits.data ? <Loading /> : kits.data.map((k: any) => (
            <div key={k.code} className="card">
              <div className="row"><b className="grow">{k.title}</b>
                {k.stages.includes(caseData.stage) ? null : <Badge tone="warn">стадия дела: проверьте применимость</Badge>}
                <Button size="sm" variant="primary" busy={busy} onClick={() => createKit(k.code)}>Сформировать комплект</Button></div>
              <div className="small muted">{k.description}</div>
              <ol className="small">{k.documents.map((c: string) => <li key={c}>{cat.data?.templates.find((t: any) => t.code === c)?.title ?? c}</li>)}</ol>
            </div>
          ))}
        </div>
      ) : null}
      {mode === "manual" ? (
        <div className="col">
          <div className="notice small">Документ создаётся в редакторе без шаблона и без участия ИИ. Правовые ссылки в тексте проверяются по справочнику.</div>
          <Field label="Наименование документа" required><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div><Button variant="primary" busy={busy} disabled={!title} onClick={() => create(null, "manual", { title, content_html: "<p></p>" })}>Создать</Button></div>
        </div>
      ) : null}
    </Modal>
  );
}
