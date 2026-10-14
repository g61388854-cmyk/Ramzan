import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmtDateTime, LEGAL_STATUS, STATUS_TONE } from "../lib/format";
import { navigate } from "../lib/router";
import { Badge, Button, Loading, Modal, Tabs, useAsync, useToast } from "../components/ui";
import Editor, { EditorHandle } from "../components/Editor";
import SourceViewer from "./SourceViewer";

const SRC_LABEL: Record<string, string> = {
  manual: "ручной ввод", case: "карточка дела", participant: "карточка участника", fact: "подтверждённый факт",
  system: "автоматически", ai: "проект ИИ", assist: "сводка фактов",
};

export default function DocumentWorkspace({ id }: { id: string }) {
  const toast = useToast();
  const docQ = useAsync(() => api.get(`/documents/${id}`), [id]);
  const caseQ = useAsync(() => docQ.data ? api.get(`/cases/${docQ.data.case_id}`) : Promise.resolve(null), [docQ.data?.case_id]);
  const partsQ = useAsync(() => docQ.data ? api.get(`/cases/${docQ.data.case_id}/participants`) : Promise.resolve([]), [docQ.data?.case_id]);
  const [values, setValues] = useState<any>({});
  const [sources, setSources] = useState<any>({});
  const [html, setHtml] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const [textDirty, setTextDirty] = useState(false);
  const [center, setCenter] = useState("form");
  const [pane, setPane] = useState("center");
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<any>(null);
  const [srcView, setSrcView] = useState<any | null>(null);
  const [compare, setCompare] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [aiResult, setAiResult] = useState<any | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 1500 || window.innerWidth <= 900);
  const editor = useRef<EditorHandle>(null);
  const versions = useAsync(() => api.get(`/documents/${id}/versions`), [id, docQ.data?.current_version?.number]);
  const exports = useAsync(() => api.get(`/documents/${id}/exports`), [id, docQ.data?.status]);

  const doc = docQ.data;
  useEffect(() => {
    if (!doc) return;
    const v = doc.current_version;
    setValues(v.field_values ?? {});
    setSources(v.field_sources ?? {});
    setHtml(v.content_html);
    setValidation(v.validation);
    setFormDirty(false);
    setTextDirty(false);
    if (!doc.template) setCenter("text");
  }, [doc]);

  const readOnly = caseQ.data?.access !== "write" || doc?.status === "archived";
  const tpl = doc?.template_detail;

  const save = useCallback(async (comment?: string) => {
    if (!doc) return;
    setBusy(true);
    try {
      const body: any = { values, sources, comment };
      if (textDirty || !doc.template) {
        body.edited = true;
        body.content_html = editor.current?.getHtml() ?? html;
      }
      const r = await api.post(`/documents/${doc.id}/versions`, body);
      if (r.unchanged) toast("info", "Изменений нет");
      else toast("ok", `Сохранена версия ${r.current_version.number}`);
      docQ.reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }, [doc, values, sources, textDirty, html, toast, docQ]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!readOnly && (formDirty || textDirty)) save();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [save, readOnly, formDirty, textDirty]);

  async function switchCenter(k: string) {
    if (k === "text" && formDirty && !textDirty && doc?.template) {
      try {
        const r = await api.post(`/documents/${doc.id}/preview`, { values, sources });
        setHtml(r.content_html);
      } catch (e: any) {
        toast("error", e.message);
      }
    }
    if (k === "text" && textDirty === false && !formDirty && doc) setHtml(doc.current_version.content_html);
    if (k === "form" && textDirty) toast("info", "Текст отредактирован вручную: при сохранении будет сохранён текст из редактора. Изменения полей формы не перезапишут ручную правку до сохранения версии.");
    setCenter(k);
  }

  function setField(key: string, val: any, src?: any) {
    setValues((v: any) => ({ ...v, [key]: val }));
    setSources((s: any) => ({ ...s, [key]: src ?? { type: "manual" } }));
    setFormDirty(true);
  }

  async function validate() {
    if (!doc) return;
    try {
      const r = await api.post(`/documents/${doc.id}/validate`);
      setValidation(r);
      toast(r.summary.errors ? "error" : "ok", `Проверка: ошибок ${r.summary.errors}, предупреждений ${r.summary.warnings}`);
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  async function setStatus(status: string) {
    if (!doc) return;
    try {
      await api.post(`/documents/${doc.id}/status`, { status, confirm: true });
      setConfirmStatus(null);
      docQ.reload();
    } catch (e: any) {
      toast("error", e.message);
      setConfirmStatus(null);
    }
  }
  async function exportDoc(fmt: string) {
    if (!doc) return;
    if (formDirty || textDirty) toast("info", "Экспортируется последняя сохранённая версия. Несохранённые изменения не включены.");
    try {
      await api.download("POST", `/documents/${doc.id}/export?fmt=${fmt}`, `${doc.title}.${fmt}`);
      docQ.reload();
      exports.reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  async function aiDraft(key: string) {
    if (!doc) return;
    setBusy(true);
    try {
      setAiResult(await api.post(`/documents/${doc.id}/ai-draft`, { field_key: key }));
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  async function openSource(type: string, srcId: string) {
    if (type === "fact" && srcId) {
      const f = await api.get(`/facts/${srcId}`);
      const s = f.sources[0];
      if (s) setSrcView({ file_id: s.file_id, fragment_id: s.fragment_id, range: s.char_start != null ? [s.char_start, s.char_end] : null });
      else toast("info", "У факта отсутствует источник");
    } else if (type === "participant") navigate(`/cases/${doc.case_id}?tab=participants`);
    else if (type === "case") navigate(`/cases/${doc.case_id}?tab=general`);
  }

  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    (tpl?.fields ?? []).forEach((f: any) => { (g[f.group || "Сведения документа"] ??= []).push(f); });
    return g;
  }, [tpl]);

  if (!doc) return <Loading error={docQ.error} />;
  const sum = validation?.summary;
  const specs = tpl?.specialization_profiles ?? [];

  return (
    <div>
      <div className="page-head">
        <div className="grow">
          <div className="small muted"><a href={`#/cases/${doc.case_id}?tab=documents`}>Дело {caseQ.data?.case_number ?? caseQ.data?.reg_id ?? ""}</a> / документ</div>
          <h1>{doc.title}</h1>
          <div className="row small">
            <Badge tone={STATUS_TONE[doc.status]}>{doc.status_label}</Badge>
            <span className="muted">версия {doc.current_version.number}{doc.template ? ` · шаблон «${doc.template.type_code}» в.${doc.template.version}` : " · без шаблона"}</span>
            {formDirty || textDirty ? <Badge tone="warn">есть несохранённые изменения</Badge> : null}
          </div>
        </div>
        <Button className="no-mobile" onClick={() => setLeftOpen((x) => !x)} aria-pressed={leftOpen}>{leftOpen ? "Скрыть сведения и версии" : "Сведения и версии"}</Button>
        {!readOnly ? <Button variant="primary" busy={busy} disabled={!formDirty && !textDirty} onClick={() => save()}>Сохранить версию (Ctrl+S)</Button> : null}
      </div>
      <div className="tabs ws-tabs">
        {[["left", "Документ"], ["center", "Редактирование"], ["right", "Проверка и источники"]].map(([k, l]) => (
          <button key={k} className={pane === k ? "active" : ""} onClick={() => setPane(k)}>{l}</button>
        ))}
      </div>
      <div className={`workspace ${leftOpen ? "" : "no-left"}`}>
        {/* Левая панель: сведения о виде документа, версии */}
        {leftOpen ? <section className={`pane pane-left ${pane === "left" ? "show" : ""}`} aria-label="Сведения о документе">
          {doc.template ? (
            <div className="col small">
              <h3>Вид документа</h3>
              <div>{tpl?.procedural_kind_label}</div>
              <div><span className="muted">Автор:</span> {doc.template.author_role}</div>
              {doc.template.addressee ? <div><span className="muted">Адресат:</span> {doc.template.addressee}</div> : null}
              <div className="row">
                {doc.template.requires_court ? <Badge tone="warn">требуется судебное решение</Badge> : null}
                {doc.template.requires_head_consent ? <Badge tone="warn">согласие руководителя</Badge> : null}
              </div>
              <div className="notice small">Статус проекта: документ не является подписанным или официально утверждённым; отметки «проверен» и «утверждён» отражают действия пользователя в системе.</div>
              {tpl?.warnings?.map((w: string, i: number) => <div key={i} className="notice warn small">{w}</div>)}
              {specs.length ? <><h3>Специализированные подсказки</h3>{specs.map((s: any) => (
                <details key={s.code} className="card" style={{ padding: 8 }}>
                  <summary><b>{s.title}</b></summary>
                  {s.warnings.map((w: string, i: number) => <div key={i} className="small">• {w}</div>)}
                  {Object.entries(s.suggestions ?? {}).map(([k, arr]: any) => (
                    <div key={k} className="small" style={{ marginTop: 4 }}>
                      <span className="muted">Варианты для поля «{tpl.fields.find((f: any) => f.key === k)?.label ?? k}»:</span>
                      {arr.map((x: string) => <div key={x} className="row"><span className="grow">{x}</span>{!readOnly ? <Button size="sm" onClick={() => {
                        const f = tpl.fields.find((ff: any) => ff.key === k);
                        if (f?.type === "list") setField(k, [...(values[k] ?? []), x]); else setField(k, x);
                      }}>Вставить</Button> : null}</div>)}
                    </div>
                  ))}
                  <div className="hint">Методические подсказки не являются нормативными требованиями.</div>
                </details>))}</> : null}
            </div>
          ) : <div className="small muted">Документ создан без шаблона.</div>}
          <h3 style={{ marginTop: 12 }}>Версии</h3>
          <div className="list small">
            {versions.data?.map((v: any) => (
              <div className="item" key={v.id}>
                <div className="grow"><a href="#" onClick={(e) => { e.preventDefault(); setViewVersion(v.number); }}>Версия {v.number}</a>
                  <div className="muted">{fmtDateTime(v.created_at)} · {v.author ?? "—"}</div><div className="muted">{v.comment}</div></div>
                {v.validation_summary ? (v.validation_summary.errors ? <Badge tone="danger">{v.validation_summary.errors}</Badge> : <Badge tone="ok">✓</Badge>) : null}
              </div>
            ))}
          </div>
          {(versions.data?.length ?? 0) > 1 ? <Button size="sm" onClick={() => setCompare(true)}>Сравнить версии</Button> : null}
        </section> : null}

        {/* Центральная область: форма и редактор */}
        <section className={`pane pane-center ${pane === "center" ? "show" : ""}`} aria-label="Редактирование">
          {doc.template ? <Tabs active={center} onChange={switchCenter} tabs={[{ key: "form", label: "Форма ввода данных" }, { key: "text", label: "Текст документа" }]} /> : null}
          {center === "form" && doc.template ? (
            <div>
              {Object.entries(groups).map(([g, fields]) => (
                <fieldset key={g} className="field-group">
                  <legend>{g}</legend>
                  <div className="form-grid">
                    {fields.map((f: any) => (
                      <FieldInput key={f.key} f={f} value={values[f.key]} source={sources[f.key]} values={values} readOnly={readOnly}
                        suggestions={doc.suggestions?.[f.key]} participants={partsQ.data ?? []}
                        onChange={(val, src) => setField(f.key, val, src)} onAi={() => aiDraft(f.key)} onSource={openSource} busy={busy} />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : (
            <Editor ref={editor} html={html} readOnly={readOnly} onDirty={() => setTextDirty(true)} onSourceClick={openSource} />
          )}
        </section>

        {/* Правая панель: проверка, правовые основания, источники, статус */}
        <section className={`pane pane-right ${pane === "right" ? "show" : ""}`} aria-label="Проверка и источники">
          <h3>Действия</h3>
          <div className="row">
            <Button size="sm" onClick={validate}>Проверить</Button>
            <Button size="sm" onClick={() => exportDoc("docx")}>DOCX</Button>
            <Button size="sm" onClick={() => exportDoc("pdf")}>PDF</Button>
            <Button size="sm" onClick={() => { setCenter("text"); setTimeout(() => window.print(), 100); }}>Печать</Button>
          </div>
          {!readOnly ? (
            <div className="row" style={{ marginTop: 6 }}>
              {["needs_review", "awaiting_input", "draft"].includes(doc.status) ? <Button size="sm" variant="primary" disabled={!!sum?.errors || formDirty || textDirty} onClick={() => setConfirmStatus("reviewed")}>Отметить «Проверен»</Button> : null}
              {doc.status === "reviewed" ? <Button size="sm" variant="primary" onClick={() => setConfirmStatus("approved")}>Отметить «Утверждён»</Button> : null}
              {["reviewed", "approved", "exported"].includes(doc.status) ? <Button size="sm" onClick={() => setStatus("needs_review")}>Вернуть на проверку</Button> : null}
              {doc.status !== "archived" ? <Button size="sm" onClick={() => setStatus("archived")}>В архив</Button> : <Button size="sm" onClick={() => setStatus("draft")}>Из архива</Button>}
            </div>) : null}
          {doc.status !== "approved" && doc.status !== "reviewed" && doc.status !== "exported" ? <div className="hint" style={{ marginTop: 4 }}>До отметки о проверке экспорт выполняется с пометкой «Проект документа».</div> : null}

          <h3 style={{ marginTop: 12 }}>Результаты проверки {sum ? <>{sum.errors ? <Badge tone="danger">ошибок {sum.errors}</Badge> : <Badge tone="ok">ошибок нет</Badge>} <Badge tone="warn">предупр. {sum.warnings}</Badge></> : null}</h3>
          {validation ? (
            <div>
              {validation.items.map((it: any, i: number) => (
                <div key={i} className="check-item">
                  <span className="lvl"><Badge tone={it.level === "error" ? "danger" : it.level === "warning" ? "warn" : "info"}>{it.level === "error" ? "ошибка" : it.level === "warning" ? "внимание" : "сведения"}</Badge></span>
                  <span>{it.message}</span>
                </div>
              ))}
              <div className="hint">{validation.disclaimer}</div>
            </div>
          ) : <div className="muted small">Проверка не выполнялась</div>}

          <h3 style={{ marginTop: 12 }}>Правовые основания</h3>
          {validation?.legal?.length ? validation.legal.map((li: any) => (
            <div key={li.key} className="legal-item small">
              <div className="row"><a href={`#/legal?key=${encodeURIComponent(li.key)}`}>{li.label}</a><Badge tone={LEGAL_STATUS[li.status]?.[1]}>{LEGAL_STATUS[li.status]?.[0]}</Badge>
                {li.source === "text" ? <Badge tone="muted">из текста</Badge> : null}{li.mandatory === false ? <Badge tone="muted">при необходимости</Badge> : null}</div>
              <div className="muted">{li.reason}</div>
              {!li.verified ? <div className="muted">{li.message}</div> : null}
            </div>
          )) : <div className="muted small">Основания не определены</div>}

          {doc.template ? (
            <>
              <h3 style={{ marginTop: 12 }}>Источники сведений</h3>
              <div className="small">
                {Object.entries(sources).map(([k, s]: any) => {
                  const f = tpl?.fields.find((ff: any) => ff.key === k);
                  return (
                    <div key={k} className="row" style={{ padding: "2px 0" }}>
                      <span className="grow">{f?.label ?? k}</span>
                      <Badge tone={s.type === "fact" ? "ok" : s.type === "ai" || s.type === "assist" ? (s.confirmed ? "info" : "machine") : "neutral"}>{SRC_LABEL[s.type] ?? s.type}{(s.type === "ai" || s.type === "assist") && !s.confirmed ? " · не подтверждено" : ""}</Badge>
                      {s.type === "fact" ? <Button size="sm" onClick={() => openSource("fact", s.id)}>Источник</Button> : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
          {exports.data?.length ? (
            <>
              <h3 style={{ marginTop: 12 }}>Журнал экспорта</h3>
              {exports.data.map((e: any) => (
                <div key={e.id} className="row small"><span className="grow">{e.format.toUpperCase()} · в.{e.version} · {fmtDateTime(e.created_at)}</span>
                  <Button size="sm" onClick={() => api.download("GET", `/exports/${e.id}/download`, `${doc.title}.${e.format}`)}>Скачать</Button></div>
              ))}
            </>
          ) : null}
        </section>
      </div>

      {confirmStatus ? (
        <Modal title={confirmStatus === "reviewed" ? "Отметка о проверке" : "Отметка об утверждении"} onClose={() => setConfirmStatus(null)}
          footer={<><Button onClick={() => setConfirmStatus(null)}>Отмена</Button><Button variant="primary" onClick={() => setStatus(confirmStatus)}>Подтверждаю</Button></>}>
          <p>{confirmStatus === "reviewed"
            ? "Подтверждаю, что проект документа проверен мной: фактические сведения сверены с источниками, правовые основания и реквизиты проверены."
            : "Подтверждаю утверждение текста документа в системе. Отметка не является электронной подписью и не заменяет подписание документа в установленном порядке."}</p>
          {sum?.warnings ? <div className="notice warn">Имеются предупреждения проверки ({sum.warnings}). Убедитесь, что они учтены.</div> : null}
        </Modal>
      ) : null}
      {aiResult ? <AiModal result={aiResult} field={tpl?.fields.find((f: any) => f.key === aiResult.field_key)} onClose={() => setAiResult(null)}
        onInsert={(text) => { setField(aiResult.field_key, text, aiResult.source); setAiResult(null); }} /> : null}
      {srcView ? <SourceViewer fileId={srcView.file_id} fragmentId={srcView.fragment_id} range={srcView.range} onClose={() => setSrcView(null)} /> : null}
      {compare ? <CompareModal docId={doc.id} versions={versions.data ?? []} onClose={() => setCompare(false)} /> : null}
      {viewVersion ? <VersionModal docId={doc.id} number={viewVersion} onClose={() => setViewVersion(null)} /> : null}
    </div>
  );
}

function FieldInput({ f, value, source, values, readOnly, suggestions, participants, onChange, onAi, onSource, busy }: {
  f: any; value: any; source: any; values: any; readOnly: boolean; suggestions?: any[]; participants: any[];
  onChange: (v: any, src?: any) => void; onAi: () => void; onSource: (t: string, id: string) => void; busy: boolean;
}) {
  const active = conditionHolds(f.condition, values);
  if (!active) return null;
  const wide = ["textarea", "list", "participants"].includes(f.type);
  const roles: string[] = (f.participant_role ?? "").split("|").filter(Boolean);
  const pList = participants.filter((p) => !roles.length || roles.includes(p.role));
  const srcInfo = source ? (
    <span className="src-tag">
      источник: {SRC_LABEL[source.type] ?? source.type}
      {source.type === "fact" ? <> · <a href="#" onClick={(e) => { e.preventDefault(); onSource("fact", source.id); }}>открыть</a></> : null}
      {(source.type === "ai" || source.type === "assist") && !source.confirmed ? <> · <Badge tone="machine">проектная формулировка</Badge>{!readOnly ? <> <a href="#" onClick={(e) => { e.preventDefault(); onChange(value, { ...source, confirmed: true }); }}>подтвердить после проверки</a></> : null}</> : null}
    </span>
  ) : null;
  let input: JSX.Element;
  const dis = readOnly;
  switch (f.type) {
    case "textarea":
      input = <textarea rows={f.narrative ? 6 : 3} disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value, source?.type === "ai" || source?.type === "assist" ? { ...source, confirmed: false } : undefined)} />;
      break;
    case "list":
      input = <textarea rows={4} disabled={dis} value={(Array.isArray(value) ? value : []).join("\n")} placeholder="Каждый пункт с новой строки" onChange={(e) => onChange(e.target.value.split("\n"))} />;
      break;
    case "select":
      input = <select disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value)}><option value="">— выберите —</option>{f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}</select>;
      break;
    case "date":
      input = <input type="date" disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "time":
      input = <input type="time" disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "datetime":
      input = <input type="datetime-local" disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "number":
      input = <input type="number" disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
      break;
    case "bool":
      input = <label className="row"><input type="checkbox" disabled={dis} checked={!!value} onChange={(e) => onChange(e.target.checked)} /> да</label>;
      break;
    case "participant":
      input = (
        <select disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value || null, e.target.value ? { type: "participant", id: e.target.value } : undefined)}>
          <option value="">— выберите участника —</option>
          {pList.map((p) => <option key={p.id} value={p.id}>{p.display_name} ({p.role_label})</option>)}
        </select>
      );
      break;
    case "participants":
      input = (
        <div className="col">
          {pList.map((p) => (
            <label key={p.id} className="row small"><input type="checkbox" disabled={dis} checked={(value ?? []).includes(p.id)}
              onChange={(e) => onChange(e.target.checked ? [...(value ?? []), p.id] : (value ?? []).filter((x: string) => x !== p.id), { type: "participant" })} /> {p.display_name} ({p.role_label})</label>
          ))}
        </div>
      );
      break;
    default:
      input = <input disabled={dis} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
  const factSugg = (suggestions ?? []).filter((s: any) => s.fact_id);
  return (
    <div className={`field ${wide ? "wide" : ""}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label className="field"><span>{f.label}{f.required ? <span className="req"> *</span> : null}</span>{input}</label>
      {f.help ? <span className="hint">{f.help}</span> : null}
      {f.type === "participant" && !pList.length ? <span className="hint">В деле нет участников с подходящим процессуальным положением — добавьте их на вкладке «Участники».</span> : null}
      {factSugg.length && !dis ? (
        <select value="" onChange={(e) => { const s = factSugg.find((x: any) => x.fact_id === e.target.value); if (s) onChange(s.value, { type: "fact", id: s.fact_id }); }} aria-label="Подставить подтверждённый факт">
          <option value="">Подставить подтверждённый факт…</option>
          {factSugg.map((s: any) => <option key={s.fact_id} value={s.fact_id}>{s.label}</option>)}
        </select>
      ) : null}
      <div className="row">
        {srcInfo}
        {f.narrative && !dis ? <Button size="sm" busy={busy} onClick={onAi} title="Проект фрагмента по подтверждённым фактам">Проект по фактам</Button> : null}
      </div>
    </div>
  );
}

function conditionHolds(cond: string | null, values: any): boolean {
  if (!cond) return true;
  return cond.split("&&").every((clause) => {
    const m = /^\s*(!)?\s*([a-z_][a-z0-9_]*)\s*(?:(==|!=|in)\s*(.+))?\s*$/.exec(clause);
    if (!m) return true;
    const [, neg, key, op, rhsRaw] = m;
    const val = values[key];
    if (!op) { const ok = !!val && val !== "false"; return neg ? !ok : ok; }
    const rhs = rhsRaw.trim();
    if (op === "in") return rhs.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).includes(String(val));
    const t = rhs.replace(/^['"]|['"]$/g, "");
    return op === "==" ? String(val) === t : String(val) !== t;
  });
}

function AiModal({ result, field, onClose, onInsert }: { result: any; field: any; onClose: () => void; onInsert: (t: string) => void }) {
  const [text, setText] = useState(result.text);
  return (
    <Modal wide title={`Проект фрагмента: ${field?.label ?? result.field_key}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!text} onClick={() => onInsert(text)}>Вставить как проектную формулировку</Button></>}>
      <div className="col">
        <div className="notice info small">{result.notice} Движок: {result.engine === "compile" ? "без языковой модели (сводка подтверждённых фактов)" : result.engine}.</div>
        {result.warnings.map((w: string, i: number) => <div key={i} className="notice warn small">{w}</div>)}
        {result.unsupported_sentences?.length ? <div className="notice danger small">Без ссылки на подтверждённый факт: {result.unsupported_sentences.map((s: string, i: number) => <div key={i}>• {s}</div>)}</div> : null}
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="small muted">Использовано фактов: {result.cited_fact_ids.length}. Вставленный текст будет выделен и заблокирует отметку о проверке до подтверждения пользователем.</div>
      </div>
    </Modal>
  );
}

function CompareModal({ docId, versions, onClose }: { docId: string; versions: any[]; onClose: () => void }) {
  const [a, setA] = useState(versions[1]?.number ?? 1);
  const [b, setB] = useState(versions[0]?.number ?? 1);
  const diff = useAsync(() => api.get(`/documents/${docId}/diff?a=${a}&b=${b}`), [a, b]);
  return (
    <Modal wide title="Сравнение версий" onClose={onClose}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span>Версия</span><select style={{ maxWidth: 100 }} value={a} onChange={(e) => setA(Number(e.target.value))}>{versions.map((v) => <option key={v.number}>{v.number}</option>)}</select>
        <span>с версией</span><select style={{ maxWidth: 100 }} value={b} onChange={(e) => setB(Number(e.target.value))}>{versions.map((v) => <option key={v.number}>{v.number}</option>)}</select>
      </div>
      {!diff.data ? <Loading error={diff.error} /> : (
        <>
          {diff.data.fields.length ? <div className="card small" style={{ marginBottom: 8 }}><b>Изменённые поля:</b>{diff.data.fields.map((f: any) => <div key={f.key}>{f.key}: {JSON.stringify(f.before)} → {JSON.stringify(f.after)}</div>)}</div> : null}
          <div className="diff card">{diff.data.lines.map((l: any, i: number) => <div key={i} className={l.op}>{l.op === "added" ? "+ " : l.op === "removed" ? "− " : "  "}{l.text}</div>)}</div>
        </>
      )}
    </Modal>
  );
}

function VersionModal({ docId, number, onClose }: { docId: string; number: number; onClose: () => void }) {
  const v = useAsync(() => api.get(`/documents/${docId}/versions/${number}`), [docId, number]);
  return (
    <Modal wide title={`Версия ${number} (только просмотр)`} onClose={onClose}>
      {!v.data ? <Loading error={v.error} /> : <div className="paper" dangerouslySetInnerHTML={{ __html: v.data.content_html }} />}
    </Modal>
  );
}


