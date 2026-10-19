// Встроенный в браузер «сервер» демонстрационной версии. Обрабатывает те же
// маршруты /api/v1, что и серверное приложение; состояние хранится в localStorage
// браузера. Все данные синтетические.
import { ApiError } from "../lib/api";
import {
  D, ROLE_LABELS, STAGE_LABELS, PROVISIONS, caseSnapshot, computeDeadline, conditionHolds, extractEntities, findReferences,
  htmlToText, lineDiff, participantSnapshot, prefill, provisionStatus, render, suggest, validate,
} from "./engine";

const KEY = "pai.demo.state.v1";
const now = () => new Date().toISOString();
const uid = () => (crypto as any).randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const STATUS_LABELS: Record<string, string> = { draft: "Черновик", awaiting_input: "Ожидает заполнения", analyzing: "Анализируется", needs_review: "Требует проверки", reviewed: "Проверен пользователем", approved: "Утверждён пользователем", exported: "Экспортирован", archived: "Архивирован" };
const TEMPLATES: Record<string, any> = Object.fromEntries(D.catalog.templates.map((t: any) => [t.code, t]));
const EVENT_TYPES = [["decision", "Процессуальное решение"], ["action", "Следственное действие"], ["expertise", "Экспертиза"], ["request", "Запрос / поручение"], ["reply", "Поступивший ответ"], ["movement", "Движение дела"], ["other", "Иное"]];
const CATEGORIES = [["source", "Исходный файл"], ["protocol", "Протокол"], ["resolution", "Постановление"], ["expert_opinion", "Заключение эксперта"], ["certificate", "Справка / ответ на запрос"], ["digital", "Цифровой документ"], ["photo", "Фотография"], ["media", "Аудио- и видеоматериал"], ["annex", "Приложение / опись"], ["statement", "Заявление / объяснение"], ["report", "Рапорт"], ["other", "Иное"]];

type State = any;
let S: State | null = null;

function initial(): State {
  const s = clone(D.seed);
  const doc = s.documents[0];
  const version = doc.current_version;
  delete doc.current_version; delete doc.suggestions; delete doc.template_detail;
  return {
    user: { ...s.user, must_change_password: false }, cases: [s.case], members: [], participants: s.participants, events: s.events,
    files: s.files, fragments: s.fragments, facts: s.facts, discrepancies: s.discrepancies, documents: [doc],
    versions: [{ ...version, author: s.user.full_name }], exports: [], deadlines: s.deadlines, history: s.history, audit: [], settings: {}, raw: {},
  };
}
function load(): State {
  if (S) return S;
  try { const t = localStorage.getItem(KEY); if (t) S = JSON.parse(t); } catch { /* недоступно */ }
  if (!S) S = initial();
  return S;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* переполнение или недоступно */ } }
export function resetDemo() { try { localStorage.removeItem(KEY); } catch { /* */ } S = null; }

const fail = (status: number, msg: string): never => { throw new ApiError(status, msg); };
const audit = (action: string, extra: any = {}) => load().audit.unshift({ id: uid(), at: now(), user_login: "demo", action, category: "action", success: true, ...extra });
const hist = (entity_type: string, entity_id: string, case_id: string, before: any, after: any, note: string | null = null) =>
  load().history.unshift({ id: Date.now(), entity_type, entity_id, changed_by: load().user.full_name, changed_at: now(), before, after, note });

function caseOf(id: string) { return load().cases.find((c: any) => c.id === id) ?? fail(404, "Дело не найдено или доступ запрещён"); }
const docOf = (id: string) => load().documents.find((d: any) => d.id === id) ?? fail(404, "Документ не найден");
const latest = (docId: string) => load().versions.filter((v: any) => v.document_id === docId).sort((a: any, b: any) => b.number - a.number)[0];
const caseParts = (cid: string) => load().participants.filter((p: any) => p.case_id === cid);
const caseFacts = (cid: string) => load().facts.filter((f: any) => f.case_id === cid);

function tplDetail(t: any) {
  return { id: t.code, ...t, specialization_profiles: D.catalog.specializations.filter((s: any) => s.applies_to.includes(t.code)), versions: [{ version: 1, origin: "builtin" }] };
}
function serDoc(d: any, withCurrent = true) {
  const t = d.type_code ? TEMPLATES[d.type_code] : null;
  const out: any = { ...d, status_label: STATUS_LABELS[d.status],
    template: t ? { id: t.code, type_code: t.code, version: 1, title: t.title, procedural_kind: t.procedural_kind, author_role: t.author_role, addressee: t.addressee, requires_court: t.requires_court, requires_head_consent: t.requires_head_consent } : null };
  if (withCurrent) out.current_version = latest(d.id);
  return out;
}
function versionSummary(v: any) { const { content_html, field_values, field_sources, validation, ...rest } = v; return { ...rest, validation_summary: validation?.summary }; }

function renderFor(c: any, t: any, values: any, sources: any) {
  const parts: any = {};
  const ids = new Set<string>();
  t.fields.forEach((f: any) => { const v = values[f.key]; if (f.type === "participant" && v) ids.add(v); if (f.type === "participants" && Array.isArray(v)) v.forEach((x: string) => ids.add(x)); });
  caseParts(c.id).filter((p: any) => ids.has(p.id)).forEach((p: any) => (parts[p.id] = participantSnapshot(p)));
  const snap = caseSnapshot(c);
  const r = render(t, values, sources, parts, snap);
  return { ...r, snapshot: { case: snap, participants: parts } };
}
function cleanValues(t: any, values: any) {
  const out: any = {};
  if (!t) return out;
  for (const f of t.fields) {
    const v = values?.[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === "list") out[f.key] = Array.isArray(v) ? v.filter((x: any) => String(x).trim()) : String(v).split("\n").filter((x) => x.trim());
    else if (f.type === "select" && v !== "" && f.options && !f.options.includes(v)) fail(422, `Недопустимое значение поля «${f.label}»`);
    else out[f.key] = v;
  }
  return out;
}
function sanitize(html: string) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const allowed = new Set(["P", "H1", "H2", "H3", "B", "STRONG", "I", "EM", "U", "BR", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SPAN", "DIV"]);
  const attrs = new Set(["class", "data-field", "data-src-type", "data-src-id", "data-required", "colspan", "rowspan"]);
  const walk = (n: Element) => {
    [...n.children].forEach((ch) => {
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].includes(ch.tagName)) { ch.remove(); return; }
      walk(ch);
      if (!allowed.has(ch.tagName)) { ch.replaceWith(...[...ch.childNodes]); return; }
      [...ch.attributes].forEach((a) => { if (!attrs.has(a.name)) ch.removeAttribute(a.name); });
    });
  };
  walk(tpl.content as unknown as Element);
  const d = document.createElement("div");
  d.appendChild(tpl.content.cloneNode(true));
  return d.innerHTML;
}
function saveVersion(d: any, html: string, values: any, sources: any, snapshot: any, comment: string) {
  const number = (latest(d.id)?.number ?? 0) + 1;
  const v: any = { id: uid(), document_id: d.id, number, content_html: html, field_values: values, field_sources: sources, case_snapshot: snapshot,
    template_version: d.type_code ? 1 : null, created_by: load().user.id, author: load().user.full_name, created_at: now(), comment };
  const c = caseOf(d.case_id);
  v.validation = validate(d, v, d.type_code ? TEMPLATES[d.type_code] : null, c, { facts: caseFacts(c.id), participants: caseParts(c.id) });
  load().versions.push(v);
  d.updated_at = now();
  return v;
}
function createDocument(c: any, body: any, kit_id: string | null = null, kit_code: string | null = null) {
  if (body.mode === "manual" || !body.type_code) {
    if (!body.title) fail(422, "Для документа без шаблона необходимо указать наименование");
    const d = { id: uid(), case_id: c.id, type_code: null, title: body.title, status: "draft", generation_mode: "manual", kit_id: null, kit_code: null, author_id: load().user.id, created_at: now(), updated_at: now() };
    load().documents.push(d);
    saveVersion(d, sanitize(body.content_html ?? "<p></p>"), {}, {}, { case: caseSnapshot(c), participants: {} }, "Создание документа вручную");
    return d;
  }
  const t = TEMPLATES[body.type_code] ?? fail(404, "Вид документа не найден в каталоге");
  const pf = prefill(c, t, caseParts(c.id), caseFacts(c.id));
  const provided = cleanValues(t, body.values);
  Object.assign(pf.values, provided);
  Object.keys(provided).forEach((k) => (pf.sources[k] = body.sources?.[k] ?? { type: "manual" }));
  const r = renderFor(c, t, pf.values, pf.sources);
  const d: any = { id: uid(), case_id: c.id, type_code: t.code, title: body.title || t.title, status: "draft", generation_mode: body.mode ?? "template", kit_id, kit_code, author_id: load().user.id, created_at: now(), updated_at: now() };
  load().documents.push(d);
  const v = saveVersion(d, r.html, pf.values, pf.sources, r.snapshot, "Формирование проекта");
  d.status = v.validation.summary.errors ? "awaiting_input" : "needs_review";
  return d;
}
function serCase(c: any) {
  const cid = c.id;
  const missing = [["case_number", "номер дела"], ["opened_at", "дата возбуждения"], ["investigative_body", "орган расследования"], ["qualification", "квалификация"], ["head_name", "руководитель следственного органа"], ["city", "место (населённый пункт)"], ["investigator_position", "должность следователя"]]
    .filter(([k]) => !c[k]).map(([, l]) => l).filter((l) => !(c.stage === "check" && ["номер дела", "дата возбуждения"].includes(l)));
  return { ...c, stage_label: STAGE_LABELS[c.stage], access: "write", missing_fields: missing, members: load().members.filter((m: any) => m.case_id === cid),
    counts: { participants: caseParts(cid).filter((p: any) => !p.is_archived).length, files: load().files.filter((f: any) => f.case_id === cid && !f.is_archived).length,
      documents: load().documents.filter((d: any) => d.case_id === cid && d.status !== "archived").length, facts_unverified: caseFacts(cid).filter((f: any) => f.status === "unverified").length,
      discrepancies_open: load().discrepancies.filter((d: any) => d.case_id === cid && d.status === "open").length, deadlines_active: load().deadlines.filter((d: any) => d.case_id === cid && ["unconfirmed", "confirmed"].includes(d.status)).length } };
}
function displayName(p: any) { return p.kind === "organization" ? p.org_name || "(организация без наименования)" : [p.last_name, p.first_name, p.patronymic].filter(Boolean).join(" ") || "(без ФИО)"; }
function factWithFiles(f: any) {
  const files = load().files;
  return { ...f, sources: f.sources.map((s: any) => { const fl = files.find((x: any) => x.id === s.file_id); return { ...s, source_code: fl?.source_code, file_name: fl?.original_name }; }) };
}

async function processUpload(c: any, file: File, category: string) {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const n = load().files.filter((f: any) => f.case_id === c.id).length + 1;
  const f: any = { id: uid(), case_id: c.id, source_code: `И-${String(n).padStart(3, "0")}`, original_name: file.name, mime: file.type || "application/octet-stream", ext, size: file.size,
    sha256: "", category, detected_kind: null, status: "processed", text_method: "digital", machine_generated: false, page_count: null, error: null, notes: null, is_archived: false, uploaded_at: now(), processed_at: now() };
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  f.sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!["txt", "csv"].includes(ext)) {
    f.status = "stored"; f.text_method = "none";
    f.notes = "Демонстрационная версия обрабатывает в браузере только TXT и CSV. Извлечение текста из DOCX, PDF, RTF, XLSX, OCR сканов и расшифровка аудио выполняются сервером в полной версии.";
    load().files.push(f); load().fragments[f.id] = []; return f;
  }
  const text = new TextDecoder("utf-8").decode(buf);
  load().raw[f.id] = text.slice(0, 200000);
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
  const head = blocks.slice(0, 3).join(" ");
  const kinds: [string, RegExp][] = [["rapport", /^\W*рапорт/i], ["interrogation_protocol", /протокол\s+допроса/i], ["inspection_protocol", /протокол\s+осмотра/i], ["explanation", /^\W*объяснение/i], ["statement", /^\W*заявление/i], ["expert_opinion", /заключение\s+эксперта/i], ["resolution", /^\W*постановление/i], ["certificate", /^\W*справка/i]];
  f.detected_kind = kinds.find(([, r]) => r.test(head))?.[0] ?? null;
  const frags = blocks.map((t, i) => ({ id: uid(), seq: i + 1, page: null, paragraph: i + 1, text: t, method: "digital", ocr_confidence: null, entities: [] as any[] }));
  const LABELS = D.meta.entity_labels;
  const grouped = new Set(["person", "case_number", "legal_ref", "phone", "birth_date"]);
  for (const fr of frags) for (const e of extractEntities(fr.text)) {
    fr.entities.push({ id: uid(), type: e.type, start: e.start, end: e.end, value: e.value, normalized: e.normalized });
    const src = { file_id: f.id, fragment_id: fr.id, page: null, char_start: e.start, char_end: e.end, quote: e.context };
    const ex = grouped.has(e.type) ? caseFacts(c.id).find((x: any) => x.fact_type === e.type && x.normalized === e.normalized && x.status !== "rejected") : null;
    if (ex) ex.sources.push(src);
    else load().facts.push({ id: uid(), case_id: c.id, fact_type: e.type, label: LABELS[e.type], content: e.value, normalized: e.normalized, origin: "extraction", status: "unverified", edited_manually: false, original_content: null, machine_generated: true, confidence: null, verified_by: null, verified_at: null, created_at: now(), sources: [src] });
  }
  load().files.push(f); load().fragments[f.id] = frags;
  return f;
}

function exportDoc(d: any, fmt: string) {
  const v = latest(d.id);
  if (fmt === "pdf") fail(422, "В демонстрационной версии PDF формируется через «Печать» → «Сохранить как PDF». Серверный экспорт PDF доступен в полной версии.");
  const draft = ["reviewed", "approved", "exported"].includes(d.status) ? "" : '<p style="text-align:right;font-size:9pt;font-style:italic">ПРОЕКТ ДОКУМЕНТА — не проверен пользователем</p>';
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${d.title}</title>
<style>@page{size:21cm 29.7cm;margin:2cm 1.5cm 2cm 3cm} body{font-family:"Times New Roman";font-size:14pt} p{margin:0;text-align:justify;text-indent:1.25cm}
p.center,p.doc-subtitle{text-align:center;text-indent:0} p.right{text-align:right;text-indent:0} h1,h2{text-align:center;font-size:14pt;margin:6pt 0 0}
.addressee p{margin-left:8.5cm;text-indent:0;text-align:left} .consent p{text-align:right;text-indent:0} table{width:100%;border-collapse:collapse}
table.card td{border:1px solid #000;font-size:12pt} .gap{background:yellow} p.pre{white-space:pre-wrap}</style></head><body>${draft}${v.content_html}</body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  if (["reviewed", "approved"].includes(d.status)) d.status = "exported";
  load().exports.unshift({ id: uid(), document_id: d.id, format: "doc", version: v.number, sha256: "—", created_by: load().user.full_name, created_at: now() });
  audit("document.export", { object_type: "document", object_id: d.id, case_id: d.case_id });
  return new Response(blob, { headers: { "Content-Type": "application/msword", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.title.slice(0, 80) + ` (в.${v.number}).doc`)}` } });
}

type Ctx = { m: string; parts: string[]; q: URLSearchParams; body: any };
const parseQ = (p: string) => { const [path, qs] = p.split("?"); return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(qs ?? "") }; };

export async function demoRequest(method: string, path: string, body: any): Promise<any> {
  const st = load();
  const { parts, q } = parseQ(path);
  const res = await route({ m: method, parts, q, body });
  if (method !== "GET") save();
  void st;
  return res;
}

async function route({ m, parts: p, q, body }: Ctx): Promise<any> {
  const st = load();
  const [a, b, c, d] = p;
  const is = (meth: string, ...segs: (string | null)[]) => m === meth && p.length === segs.length && segs.every((s, i) => s === null || s === p[i]);

  // --- аутентификация
  if (is("POST", "auth", "login")) {
    if (body.login !== "demo" || body.password !== "Demo-Pass-2026") fail(401, "Неверный логин или пароль. Демо-доступ: demo / Demo-Pass-2026");
    return { token: "demo-token", expires_at: now(), idle_minutes: 30, user: st.user };
  }
  if (is("POST", "auth", "logout")) return { ok: true };
  if (is("GET", "auth", "me")) return { ...st.user, idle_minutes: 30 };
  if (is("POST", "auth", "change-password")) fail(422, "В демонстрационной версии пароль не меняется");

  // --- справочники и служебные
  if (is("GET", "meta", "stages")) return { stages: D.meta.stages, event_types: EVENT_TYPES.map(([code, label]) => ({ code, label })), now: now() };
  if (is("GET", "participants", "schema")) return { roles: D.meta.roles, schemas: D.meta.schemas };
  if (is("GET", "files", "categories")) return { categories: CATEGORIES.map(([code, label]) => ({ code, label })), allowed_extensions: ["txt", "csv", "docx", "pdf", "rtf", "xlsx", "png", "jpg"], max_upload_mb: 10, entity_labels: D.meta.entity_labels, doc_kind_labels: D.meta.doc_kind_labels };
  if (is("GET", "system", "status")) return { ai: { provider: "none", available: false }, ocr: { engine: null }, legal_registry_updated_at: null, templates: D.catalog.templates.length, demo: true };
  if (is("GET", "users", "directory")) return [{ id: st.user.id, full_name: st.user.full_name, position: st.user.position, unit: st.user.unit, role: "investigator" }];
  if (a === "users" || a === "audit" && !b) {
    if (a === "audit") return st.audit.slice(0, 300);
    fail(403, "Администрирование недоступно в демонстрационной версии");
  }
  if (is("GET", "settings")) return st.settings;
  if (is("GET", "tasks", null)) return { id: b, status: "done", progress: 100 };

  if (is("GET", "dashboard")) {
    const cases = st.cases.filter((x: any) => !x.is_archived);
    const docs = st.documents;
    const cn = (cid: string) => st.cases.find((x: any) => x.id === cid)?.case_number;
    const di = (x: any) => ({ id: x.id, title: x.title, status: x.status, status_label: STATUS_LABELS[x.status], case_id: x.case_id, case_number: cn(x.case_id), updated_at: x.updated_at });
    const inWork = docs.filter((x: any) => ["draft", "awaiting_input", "analyzing"].includes(x.status)).map(di);
    const review = docs.filter((x: any) => x.status === "needs_review").map(di);
    const dl = st.deadlines.filter((x: any) => ["unconfirmed", "confirmed"].includes(x.status) && x.due_at && new Date(x.due_at).getTime() < Date.now() + 14 * 864e5)
      .map((x: any) => ({ ...x, case_number: cn(x.case_id), overdue: new Date(x.due_at).getTime() < Date.now() }));
    return { counts: { active_cases: cases.length, in_work: inWork.length, needs_review: review.length, deadlines_14d: dl.length },
      recent_cases: cases.map((x: any) => ({ ...x, stage_label: STAGE_LABELS[x.stage] })), documents_in_work: inWork, documents_review: review, deadlines: dl,
      missing_data: cases.map((x: any) => ({ case_id: x.id, reg_id: x.reg_id, case_number: x.case_number, missing: serCase(x).missing_fields })).filter((x: any) => x.missing.length),
      recent_uploads: [...st.files].reverse().slice(0, 10).map((f: any) => ({ ...f, case_number: cn(f.case_id) })),
      history: st.audit.slice(0, 15) };
  }
  if (is("GET", "search")) {
    const s = (q.get("q") ?? "").toLowerCase();
    const frs: any[] = [];
    for (const f of st.files) for (const fr of st.fragments[f.id] ?? []) {
      const i = fr.text.toLowerCase().indexOf(s);
      if (i >= 0) frs.push({ fragment_id: fr.id, file_id: f.id, case_id: f.case_id, source_code: f.source_code, file_name: f.original_name, page: fr.page, snippet: fr.text.slice(Math.max(0, i - 80), i + 160) });
    }
    return { cases: st.cases.filter((x: any) => [x.case_number, x.reg_id, x.fabula, x.qualification].some((v) => (v ?? "").toLowerCase().includes(s))).map((x: any) => ({ ...x, stage_label: STAGE_LABELS[x.stage] })),
      participants: st.participants.filter((x: any) => displayName(x).toLowerCase().includes(s)),
      documents: st.documents.filter((x: any) => x.title.toLowerCase().includes(s) || (latest(x.id)?.content_html ?? "").toLowerCase().includes(s)).map((x: any) => ({ ...x, status_label: STATUS_LABELS[x.status] })),
      fragments: frs.slice(0, 50) };
  }

  // --- дела
  if (is("GET", "cases")) {
    const s = (q.get("q") ?? "").toLowerCase(), stage = q.get("stage"), arch = q.get("archived") === "true";
    return st.cases.filter((x: any) => !!x.is_archived === arch && (!stage || x.stage === stage) && (!s || [x.case_number, x.reg_id, x.fabula, x.qualification].some((v) => (v ?? "").toLowerCase().includes(s))))
      .map((x: any) => ({ ...x, stage_label: STAGE_LABELS[x.stage], access: "write" }));
  }
  if (is("POST", "cases")) {
    const cs = { id: uid(), reg_id: `PAI-2026-${String(st.cases.length + 1).padStart(6, "0")}`, case_number: null, opened_at: null, investigative_body: null, unit: st.user.unit, investigator_id: st.user.id,
      investigator: st.user, investigator_position: st.user.position, head_name: null, head_position: null, city: null, qualification: null, fabula: null, stage: "check", key_dates: {}, is_archived: false,
      created_at: now(), updated_at: now(), ...body };
    st.cases.push(cs); hist("case", cs.id, cs.id, null, body, "Создание карточки"); audit("case.create", { case_id: cs.id });
    return serCase(cs);
  }
  if (a === "cases" && b && !c) {
    const cs = caseOf(b);
    if (m === "GET") return serCase(cs);
    const before = Object.fromEntries(Object.keys(body).map((k) => [k, cs[k]]));
    Object.assign(cs, body, { updated_at: now() });
    hist("case", cs.id, cs.id, before, body); audit("case.update", { case_id: cs.id });
    return serCase(cs);
  }
  if (a === "cases" && b) {
    const cs = caseOf(b);
    switch (c) {
      case "history": return st.history.filter((h: any) => h.entity_type === "case" ? h.entity_id === cs.id : true);
      case "members": return fail(422, "В демонстрационной версии один пользователь");
      case "participants":
        if (m === "GET") return caseParts(cs.id).filter((x: any) => q.get("archived") === "true" || !x.is_archived);
        {
          if (body.kind !== "organization" && !body.last_name) fail(422, "Для физического лица необходимо указать фамилию");
          const pt: any = { id: uid(), case_id: cs.id, is_archived: false, created_at: now(), updated_at: now(), kind: "person", data: {}, ...body };
          pt.display_name = displayName(pt); pt.role_label = ROLE_LABELS[pt.role];
          st.participants.push(pt); hist("participant", pt.id, cs.id, null, body, "Добавление участника"); audit("participant.create", { case_id: cs.id });
          return pt;
        }
      case "events":
        if (m === "GET") return st.events.filter((e: any) => e.case_id === cs.id && !e.is_archived);
        { const e = { id: uid(), case_id: cs.id, is_archived: false, created_at: now(), ...body }; st.events.push(e); return e; }
      case "timeline": {
        const items: any[] = st.events.filter((e: any) => e.case_id === cs.id && !e.is_archived).map((e: any) => ({ date: e.occurred_at, kind: "event", event_type: e.event_type, title: e.title, description: e.description, machine: false, id: e.id }));
        if (q.get("include_extracted") !== "false") for (const f of st.files.filter((x: any) => x.case_id === cs.id && !x.is_archived))
          for (const fr of st.fragments[f.id] ?? []) for (const e of fr.entities.filter((x: any) => ["incident_date", "date"].includes(x.type)))
            items.push({ date: e.normalized, kind: "extracted", event_type: e.type, title: `Упоминание даты (${f.source_code})`, description: fr.text.slice(Math.max(0, e.start - 90), e.end + 90), machine: true, file_id: f.id, fragment_id: fr.id, id: e.id });
        return items.sort((x, y) => String(x.date).localeCompare(String(y.date)));
      }
      case "files":
        if (m === "GET") return st.files.filter((f: any) => f.case_id === cs.id && (q.get("archived") === "true" || !f.is_archived));
        { const file = body.get("file") as File; if (file.size > 10 * 1024 * 1024) fail(422, "Размер файла превышает 10 МБ");
          const f = await processUpload(cs, file, body.get("category") ?? "other"); audit("file.upload", { case_id: cs.id, object_id: f.id });
          return { file: f, task: { id: uid(), status: "done", progress: 100 }, warnings: f.notes ? [f.notes] : [] }; }
      case "entities": return [];
      case "facts":
        if (m === "GET") return caseFacts(cs.id).filter((f: any) => (!q.get("status") || f.status === q.get("status")) && (!q.get("fact_type") || f.fact_type === q.get("fact_type"))).map(factWithFiles);
        { const f: any = { id: uid(), case_id: cs.id, fact_type: body.fact_type, label: D.meta.entity_labels[body.fact_type], content: body.content, normalized: body.normalized ?? null, origin: "manual", status: "unverified", edited_manually: false, original_content: null, machine_generated: false, confidence: null, created_at: now(),
            sources: body.file_id ? [{ file_id: body.file_id, fragment_id: null, page: null, quote: body.quote }] : [] };
          st.facts.push(f); return factWithFiles(f); }
      case "discrepancies":
        if (d === "refresh") return { detected: st.discrepancies.filter((x: any) => x.case_id === cs.id).length, created: 0, stale: 0 };
        return st.discrepancies.filter((x: any) => x.case_id === cs.id);
      case "documents":
        if (m === "GET") return st.documents.filter((x: any) => x.case_id === cs.id).sort((x: any, y: any) => y.updated_at.localeCompare(x.updated_at)).map((x: any) => ({ ...serDoc(x, false), latest_version: versionSummary(latest(x.id)) }));
        { const doc = createDocument(cs, body); audit("document.create", { case_id: cs.id, object_id: doc.id }); return { ...serDoc(doc), suggestions: {} }; }
      case "kits": {
        const kit = D.catalog.kits.find((k: any) => k.code === body.kit_code) ?? fail(404, "Комплект не найден");
        const kid = uid();
        const docs = kit.documents.map((code: string) => createDocument(cs, { type_code: code, mode: "kit" }, kid, kit.code));
        return { kit_id: kid, kit, documents: docs.map((x: any) => ({ ...serDoc(x, false), latest_version: versionSummary(latest(x.id)) })), notice: "Каждый документ комплекта сформирован отдельно и требует самостоятельной проверки." };
      }
      case "assistant": {
        const ranked: any[] = suggest(body.text, cs.stage);
        for (const r of ranked.slice(0, 3)) {
          const t = TEMPLATES[r.code];
          const pf = prefill(cs, t, caseParts(cs.id), caseFacts(cs.id));
          r.clarifying_questions = t.fields.filter((f: any) => f.required && conditionHolds(f.condition, pf.values) && !pf.values[f.key]).map((f: any) => ({ key: f.key, question: `Укажите: ${f.label}`, type: f.type, options: f.options }));
          r.stage_ok = !t.stages.length || t.stages.includes(cs.stage); r.author_role = t.author_role;
        }
        return { suggestions: ranked, notice: "Подбор вида документа носит рекомендательный характер; выбор осуществляет пользователь." };
      }
      case "deadlines":
        if (m === "GET") return st.deadlines.filter((x: any) => x.case_id === cs.id);
        { const rule = D.deadline_rules.find((r: any) => r.code === body.rule_code);
          const calc = computeDeadline(body.rule_code, body.start_at, body.params, body.adjustments, st.settings.nonworking_days ?? []);
          const dl = { id: uid(), case_id: cs.id, title: body.title || rule.title, status: "unconfirmed", created_at: now(), ...body, due_at: calc.due_at, calculation: calc, legal_basis_key: calc.basis_key };
          dl.title = body.title || rule.title; st.deadlines.push(dl); hist("deadline", dl.id, cs.id, null, { due_at: dl.due_at, status: dl.status }, "Регистрация срока"); return dl; }
      case "audit": return st.audit.filter((x: any) => x.case_id === cs.id);
    }
  }

  // --- участники, события
  if (is("PATCH", "participants", null)) {
    const pt = st.participants.find((x: any) => x.id === b) ?? fail(404, "Участник не найден");
    const before = { ...pt }; Object.assign(pt, body, { updated_at: now() }); pt.display_name = displayName(pt); pt.role_label = ROLE_LABELS[pt.role];
    hist("participant", pt.id, pt.case_id, { role: before.role, last_name: before.last_name, data: before.data }, { role: pt.role, last_name: pt.last_name, data: pt.data });
    return pt;
  }
  if (is("PATCH", "events", null)) { const e = st.events.find((x: any) => x.id === b); Object.assign(e, body); return e; }

  // --- материалы и факты
  if (a === "files" && b) {
    const f = st.files.find((x: any) => x.id === b) ?? fail(404, "Файл не найден");
    if (!c && m === "GET") return f;
    if (!c && m === "PATCH") { Object.assign(f, body); return f; }
    if (c === "fragments") return { file: f, fragments: st.fragments[f.id] ?? [] };
    if (c === "reprocess") return { id: uid(), status: "done", progress: 100 };
    if (c === "download") {
      const text = st.raw[f.id] ?? (st.fragments[f.id] ?? []).map((x: any) => x.text).join("\n\n");
      return new Response(new Blob([text], { type: "text/plain;charset=utf-8" }), { headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}` } });
    }
  }
  if (a === "facts" && b) {
    const f = st.facts.find((x: any) => x.id === b) ?? fail(404, "Факт не найден");
    if (m === "GET") {
      const out = factWithFiles(f);
      out.sources = out.sources.map((s: any) => { const fr = (st.fragments[s.file_id] ?? []).find((x: any) => x.id === s.fragment_id); return { ...s, fragment_text: fr?.text, paragraph: fr?.paragraph, fragment_method: fr?.method }; });
      out.history = st.history.filter((h: any) => h.entity_type === "fact" && h.entity_id === f.id).reverse();
      return out;
    }
    const before = { content: f.content, status: f.status };
    if (body.content !== undefined && body.content !== f.content) { if (!f.edited_manually) f.original_content = f.content; f.edited_manually = true; f.content = body.content; }
    if (body.status) { f.status = body.status; f.verified_by = body.status === "unverified" ? null : st.user.id; f.verified_at = body.status === "unverified" ? null : now(); audit(`fact.${body.status}`, { case_id: f.case_id }); }
    hist("fact", f.id, f.case_id, before, { content: f.content, status: f.status });
    return factWithFiles(f);
  }
  if (is("PATCH", "discrepancies", null)) { const x = st.discrepancies.find((y: any) => y.id === b); Object.assign(x, body); return x; }

  // --- каталог
  if (is("GET", "templates")) return { sections: D.catalog.sections, kinds: D.catalog.kinds, templates: D.catalog.templates.map(({ body: _b, fields: _f, ...t }: any) => ({ ...t, id: t.code })) };
  if (is("GET", "templates", "kits")) return D.catalog.kits;
  if (is("GET", "templates", "specializations")) return D.catalog.specializations;
  if (is("POST", "templates", "import")) fail(403, "Загрузка шаблонов недоступна в демонстрационной версии");
  if (is("GET", "templates", null)) return tplDetail(TEMPLATES[b] ?? fail(404, "Вид документа не найден"));

  // --- документы
  if (a === "documents" && b) {
    const doc = docOf(b);
    const t = doc.type_code ? TEMPLATES[doc.type_code] : null;
    const cs = caseOf(doc.case_id);
    if (!c && m === "GET") {
      const out: any = serDoc(doc);
      if (t) { out.suggestions = prefill(cs, t, caseParts(cs.id), caseFacts(cs.id)).suggestions; out.template_detail = tplDetail(t); }
      return out;
    }
    switch (c) {
      case "preview": { const vals = cleanValues(t, body.values); const r = renderFor(cs, t, vals, body.sources ?? {}); return { content_html: r.html, missing: r.missing }; }
      case "versions":
        if (m === "GET" && d) return st.versions.find((v: any) => v.document_id === doc.id && v.number === Number(d)) ?? fail(404, "Версия не найдена");
        if (m === "GET") return st.versions.filter((v: any) => v.document_id === doc.id).sort((x: any, y: any) => y.number - x.number).map((v: any) => ({ ...versionSummary(v), author: v.author }));
        {
          if (doc.status === "archived") fail(409, "Документ архивирован");
          const vals = cleanValues(t, body.values);
          let html: string, snap: any;
          if (body.edited || !t) { html = sanitize(body.content_html ?? ""); snap = { case: caseSnapshot(cs), participants: {} }; }
          else { const r = renderFor(cs, t, vals, body.sources ?? {}); html = r.html; snap = r.snapshot; }
          const prev = latest(doc.id);
          if (prev && prev.content_html === html && JSON.stringify(prev.field_values) === JSON.stringify(vals)) return { ...serDoc(doc), unchanged: true };
          const v = saveVersion(doc, html, vals, body.sources ?? {}, snap, body.comment || (body.edited ? "Редактирование текста" : "Изменение данных формы"));
          if (["reviewed", "approved", "exported"].includes(doc.status)) Object.assign(doc, { reviewed_by: null, reviewed_at: null, approved_by: null, approved_at: null });
          doc.status = v.validation.summary.errors ? "awaiting_input" : "needs_review";
          audit("document.version", { case_id: cs.id, object_id: doc.id });
          return serDoc(doc);
        }
      case "diff": {
        const va = st.versions.find((v: any) => v.document_id === doc.id && v.number === Number(q.get("a")));
        const vb = st.versions.find((v: any) => v.document_id === doc.id && v.number === Number(q.get("b")));
        const lines = (v: any) => htmlToText(v.content_html).split("\n").map((s) => s.trim()).filter(Boolean);
        const keys = new Set([...Object.keys(va.field_values), ...Object.keys(vb.field_values)]);
        return { a: va.number, b: vb.number, lines: lineDiff(lines(va), lines(vb)),
          fields: [...keys].filter((k) => JSON.stringify(va.field_values[k]) !== JSON.stringify(vb.field_values[k])).map((k) => ({ key: k, before: va.field_values[k], after: vb.field_values[k] })) };
      }
      case "validate": { const v = latest(doc.id); v.validation = validate(doc, v, t, cs, { facts: caseFacts(cs.id), participants: caseParts(cs.id) }); return v.validation; }
      case "legal": { const v = latest(doc.id); return { legal: validate(doc, v, t, cs, { facts: caseFacts(cs.id), participants: caseParts(cs.id) }).legal, registry_updated_at: null }; }
      case "status": {
        const allowed: any = { draft: ["awaiting_input", "needs_review", "archived"], awaiting_input: ["needs_review", "draft", "archived"], needs_review: ["reviewed", "draft", "archived"], reviewed: ["approved", "needs_review", "archived"], approved: ["needs_review", "archived"], exported: ["needs_review", "archived"], archived: ["draft"] };
        if (!(allowed[doc.status] ?? []).includes(body.status)) fail(409, `Переход из статуса «${STATUS_LABELS[doc.status]}» в «${STATUS_LABELS[body.status]}» недопустим`);
        if (["reviewed", "approved"].includes(body.status)) {
          const v = latest(doc.id); v.validation = validate(doc, v, t, cs, { facts: caseFacts(cs.id), participants: caseParts(cs.id) });
          if (v.validation.summary.errors) fail(409, `Документ содержит ошибки проверки (${v.validation.summary.errors}); отметка невозможна`);
        }
        if (body.status === "reviewed") Object.assign(doc, { reviewed_by: st.user.id, reviewed_at: now() });
        if (body.status === "approved") Object.assign(doc, { approved_by: st.user.id, approved_at: now() });
        doc.status = body.status; audit("document.status", { case_id: cs.id, object_id: doc.id });
        return serDoc(doc);
      }
      case "export": return exportDoc(doc, q.get("fmt") ?? "docx");
      case "exports": return st.exports.filter((x: any) => x.document_id === doc.id);
      case "ai-draft": {
        const field = t?.fields.find((f: any) => f.key === body.field_key);
        if (!field?.narrative) fail(422, "Для данного поля формирование проекта не предусмотрено");
        const facts = caseFacts(cs.id).filter((f: any) => f.status === "confirmed").map(factWithFiles);
        const text = facts.map((f: any) => `${f.content} (источник: ${[...new Set(f.sources.map((s: any) => s.source_code))].join(", ") || "не указан"})`).join("\n");
        return { field_key: field.key, text, engine: "compile", cited_fact_ids: facts.map((f: any) => f.id),
          warnings: facts.length ? ["Языковая модель не подключена: сформирована сводка подтверждённых фактов без генерации текста."] : ["Нет подтверждённых фактов для формирования проекта"],
          unsupported_sentences: [], source: { type: "assist", confirmed: false, engine: "compile", cited: facts.map((f: any) => f.id) },
          notice: "Проектная формулировка требует проверки и подтверждения пользователем." };
      }
    }
  }
  if (a === "exports") fail(422, "Повторная выдача файла недоступна в демонстрационной версии — выполните экспорт заново");

  // --- правовой справочник
  if (a === "legal") {
    const ser = (p: any) => ({ id: p.key, ...p, part: null, item: null, status: provisionStatus(p.key) });
    if (b === "status") return { updated_at: null, provisions: D.legal.provisions.length, with_text: 0, verified: 0, mode: "local", notice: "Демонстрационная версия: тексты норм не загружены. Актуальность ссылок не подтверждается." };
    if (b === "acts" && !c) return D.legal.acts.map((x: any) => ({ id: x.code, ...x, official_source: "http://pravo.gov.ru", provisions: D.legal.provisions.filter((p: any) => p.act_code === x.code).length }));
    if (b === "acts" && d === "provisions") { const act = D.legal.acts.find((x: any) => x.code === c); return { act: { ...act, official_source: "http://pravo.gov.ru" }, provisions: D.legal.provisions.filter((p: any) => p.act_code === c).map(ser) }; }
    if (b === "provisions") { const pr = PROVISIONS[decodeURIComponent(c)] ?? fail(404, "Норма отсутствует в справочнике"); return { ...ser(pr), versions: [{ id: "v-" + pr.key, text: null, valid_from: null, valid_to: null, source: "Текст не загружен. Требуется импорт из официального источника.", verified: false }] }; }
    if (b === "search") {
      const s = q.get("q") ?? "";
      const refs = findReferences(s);
      if (refs.length) return { results: refs.filter((r) => PROVISIONS[r.key]).map((r) => ser(PROVISIONS[r.key])), not_found: refs.filter((r) => !PROVISIONS[r.key]).map((r) => r.key) };
      return { results: D.legal.provisions.filter((p: any) => (p.heading ?? "").toLowerCase().includes(s.toLowerCase()) || p.article === s).slice(0, 50).map(ser), not_found: [] };
    }
    if (b === "check") return { key: q.get("key"), ...provisionStatus(q.get("key") ?? "") };
    fail(403, "Импорт и верификация редакций недоступны в демонстрационной версии");
  }

  // --- сроки
  if (a === "deadlines") {
    if (b === "rules") return D.deadline_rules;
    if (b === "preview") return computeDeadline(body.rule_code, body.start_at, body.params, body.adjustments, st.settings.nonworking_days ?? []);
    if (!b) return st.deadlines.filter((x: any) => ["unconfirmed", "confirmed"].includes(x.status) && x.due_at).map((x: any) => {
      const left = (new Date(x.due_at).getTime() - Date.now()) / 864e5;
      const cs = st.cases.find((y: any) => y.id === x.case_id);
      return { ...x, case_number: cs?.case_number, case_reg_id: cs?.reg_id, overdue: left < 0, notify: left >= 0 && left <= (x.notify_days_before ?? 3) };
    });
    const dl = st.deadlines.find((x: any) => x.id === b) ?? fail(404, "Срок не найден");
    if (c === "history") return st.history.filter((h: any) => h.entity_type === "deadline" && h.entity_id === dl.id).reverse();
    const before = { due_at: dl.due_at, status: dl.status };
    Object.assign(dl, body);
    if (body.start_at || body.params || body.adjustments) {
      const calc = computeDeadline(dl.rule_code, dl.start_at, dl.params, dl.adjustments, st.settings.nonworking_days ?? []);
      dl.due_at = calc.due_at; dl.calculation = calc;
      if (dl.status === "confirmed" && !body.status) dl.status = "unconfirmed";
    }
    if (body.status === "confirmed") Object.assign(dl, { confirmed_by: st.user.id, confirmed_at: now() });
    hist("deadline", dl.id, dl.case_id, before, { due_at: dl.due_at, status: dl.status });
    return dl;
  }
  return fail(404, `Маршрут недоступен в демонстрационной версии: ${m} /${p.join("/")}`);
}
