// Перенос серверной логики (generator, validator, legal, deadlines, classifier, extractor)
// для демонстрационной версии, работающей без сервера. Эталонная реализация — backend/app/services.
import nunjucks from "nunjucks/browser/nunjucks.js";
import data from "./data.json";

export const D: any = data;
const SafeString = nunjucks.runtime.SafeString;

// Шаблоны используют метод Python str.startswith
if (!(String.prototype as any).startswith) {
  Object.defineProperty(String.prototype, "startswith", { value: function (this: string, s: string) { return this.startsWith(s); } });
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(D.meta.roles.map((r: any) => [r.code, r.label]));
export const STAGE_LABELS: Record<string, string> = Object.fromEntries(D.meta.stages.map((r: any) => [r.code, r.label]));

export function toDate(v: any): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const p2 = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const fmtDate = (v: any) => { const d = toDate(v); return d ? `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}` : (v ? String(v) : ""); };
export const fmtDateLong = (v: any) => { const d = toDate(v); return d ? `«${p2(d.getDate())}» ${MONTHS[d.getMonth()]} ${d.getFullYear()} г.` : (v ? String(v) : ""); };
const fmtDateText = (v: any) => { const d = toDate(v); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} года` : (v ? String(v) : ""); };
const fmtTime = (v: any) => { if (!v) return ""; const [h, m] = String(v).slice(0, 5).split(":"); return m !== undefined ? `${p2(Number(h))} ч ${p2(Number(m))} мин` : String(v); };
export function shortName(full?: string | null) {
  if (!full) return "";
  const p = full.split(/\s+/);
  return p.length < 2 ? full : `${p.slice(1, 3).map((x) => x[0] + ".").join("")} ${p[0]}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --- условия полей ---
export function conditionHolds(cond: string | null | undefined, values: any): boolean {
  if (!cond) return true;
  return cond.split("&&").every((clause) => {
    const m = /^\s*(!)?\s*([a-z_][a-z0-9_]*)\s*(?:(==|!=|in)\s*(.+))?\s*$/.exec(clause);
    if (!m) return true;
    const [, neg, key, op, rhsRaw] = m;
    const val = values[key];
    if (!op) { const ok = !!val && val !== "false" && val !== "нет"; return neg ? !ok : ok; }
    const rhs = rhsRaw.trim();
    if (op === "in") return rhs.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).includes(String(val));
    const t = rhs.replace(/^['"]|['"]$/g, "");
    return op === "==" ? String(val) === t : String(val) !== t;
  });
}

// --- снимки ---
export function participantSnapshot(p: any) {
  const snap: any = { id: p.id, role: p.role, role_label: ROLE_LABELS[p.role] ?? p.role, kind: p.kind, display_name: p.display_name,
    short_name: p.kind === "person" ? shortName(p.display_name) : p.display_name, last_name: p.last_name, first_name: p.first_name,
    patronymic: p.patronymic, org_name: p.org_name };
  for (const [k, v] of Object.entries(p.data ?? {})) snap[k] = k.endsWith("_date") ? fmtDate(v) : v;
  return snap;
}

export function caseSnapshot(c: any) {
  return { id: c.id, reg_id: c.reg_id, case_number: c.case_number, opened_at: c.opened_at, investigative_body: c.investigative_body,
    unit: c.unit, investigator_name: shortName(c.investigator?.full_name), investigator_full_name: c.investigator?.full_name,
    investigator_position: c.investigator_position, head_name: c.head_name, head_position: c.head_position, city: c.city,
    qualification: c.qualification, fabula: c.fabula, stage: c.stage };
}

export function prefill(c: any, tpl: any, participants: any[], facts: any[]) {
  const snap: any = caseSnapshot(c);
  const values: any = {}, sources: any = {}, suggestions: any = {};
  for (const f of tpl.fields) {
    const b = f.binding ?? "";
    if (b === "today") { values[f.key] = isoDate(new Date()); sources[f.key] = { type: "system", label: "Текущая дата (проверьте)" }; }
    else if (b.startsWith("case.")) {
      const a = b.slice(5);
      if (snap[a]) { values[f.key] = snap[a]; sources[f.key] = { type: "case", field: a, label: "Карточка дела" }; }
    } else if (b.startsWith("fact:")) {
      const ft = b.slice(5);
      const fs = facts.filter((x) => x.fact_type === ft && x.status === "confirmed");
      suggestions[f.key] = fs.map((x) => ({ fact_id: x.id, value: x.normalized || x.content, label: x.content }));
      if (fs.length === 1) { values[f.key] = f.type === "date" && fs[0].normalized ? fs[0].normalized : fs[0].content; sources[f.key] = { type: "fact", id: fs[0].id, label: "Подтверждённый факт" }; }
    }
    if ((f.type === "participant" || f.type === "participants") && f.participant_role) {
      const roles = f.participant_role.split("|");
      const cands = participants.filter((p) => !p.is_archived && roles.includes(p.role));
      suggestions[f.key] = cands.map((p) => ({ participant_id: p.id, label: `${p.display_name} (${ROLE_LABELS[p.role]})` }));
      if (f.type === "participant" && cands.length === 1) { values[f.key] = cands[0].id; sources[f.key] = { type: "participant", id: cands[0].id, label: "Карточка участника" }; }
      else if (f.type === "participants" && cands.length) { values[f.key] = cands.map((p) => p.id); sources[f.key] = { type: "participant", ids: cands.map((p) => p.id), label: "Карточки участников" }; }
    }
  }
  return { values, sources, suggestions };
}

// --- рендеринг ---
const ATTR_LABELS: Record<string, string> = {
  display_name: "ФИО / наименование", short_name: "фамилия и инициалы", birth_date: "дата рождения", birth_place: "место рождения",
  citizenship: "гражданство", address_registration: "адрес регистрации", address_actual: "адрес проживания",
  identity_document: "документ, удостоверяющий личность", occupation: "место работы (учёбы), должность", phone: "телефон",
  warrant: "ордер", role_label: "процессуальное положение",
};
const filled = (v: any) => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : typeof v === "object" ? Object.keys(v).length > 0 : String(v).trim() !== "");
function span(key: string, text: string, src?: any) {
  const s = src ?? { type: "manual" };
  const cls = (s.type === "ai" || s.type === "assist") && !s.confirmed ? "fv ai" : "fv";
  let attrs = ` data-field="${esc(key)}" data-src-type="${esc(s.type ?? "manual")}"`;
  if (s.id) attrs += ` data-src-id="${esc(s.id)}"`;
  return new SafeString(`<span class="${cls}"${attrs}>${esc(text).replace(/\n/g, "<br>")}</span>`);
}
const gap = (key: string, label: string, req: boolean) => new SafeString(`<span class="gap" data-field="${esc(key)}" data-required="${req ? 1 : 0}">[не заполнено: ${esc(label)}]</span>`);
function display(f: any, v: any, parts: any, long = false): string {
  switch (f.type) {
    case "date": return long ? fmtDateLong(v) : fmtDate(v);
    case "time": return fmtTime(v);
    case "datetime": { const s = String(v); return s.length >= 16 ? `${fmtDate(s.slice(0, 10))} ${fmtTime(s.slice(11, 16))}` : s; }
    case "bool": return v === true || v === "true" ? "да" : "нет";
    case "participant": return parts[v]?.display_name ?? "";
    case "participants": return (v ?? []).filter((i: string) => parts[i]).map((i: string) => parts[i].display_name).join(", ");
    case "list": { const items = Array.isArray(v) ? v : String(v).split("\n"); return items.filter((x: string) => String(x).trim()).map((x: string, i: number) => `${i + 1}) ${x}`).join("\n"); }
    default: return String(v);
  }
}

class MemLoader {
  constructor(private src: Record<string, string>) {}
  getSource(name: string) { return { src: this.src[name], path: name, noCache: true }; }
}

export function render(tpl: any, values: any, sources: any, parts: any, caseSnap: any): { html: string; missing: string[] } {
  const v: any = {}, vc: any = {}, vl: any = {}, has: any = {}, raw: any = {};
  const missing: string[] = [];
  const byKey: any = Object.fromEntries(tpl.fields.map((f: any) => [f.key, f]));
  for (const f of tpl.fields) {
    const val = values[f.key];
    const active = conditionHolds(f.condition, values);
    raw[f.key] = val ?? null;
    if (active && filled(val)) {
      const shown = display(f, val, parts);
      v[f.key] = span(f.key, shown, sources[f.key]);
      vc[f.key] = span(f.key, shown.charAt(0).toUpperCase() + shown.slice(1), sources[f.key]);
      vl[f.key] = span(f.key, display(f, val, parts, true), sources[f.key]);
      has[f.key] = true;
    } else {
      const req = !!(f.required && active);
      if (req) missing.push(f.key);
      v[f.key] = vc[f.key] = vl[f.key] = active ? gap(f.key, f.label, req) : new SafeString("");
      has[f.key] = false;
    }
  }
  const pOf = (key: string) => (typeof raw[key] === "string" ? parts[raw[key]] : null);
  const pval = (key: string, attr: string) => pOf(key)?.[attr] ?? null;
  const pv = (key: string, attr: string, required = false) => {
    const p = pOf(key);
    if (p && filled(p[attr])) return span(`${key}.${attr}`, String(p[attr]), { type: "participant", id: p.id });
    return gap(`${key}.${attr}`, `${byKey[key]?.label ?? key} — ${ATTR_LABELS[attr] ?? attr}`, required);
  };
  const plist = (key: string) => (raw[key] ?? []).filter((i: string) => parts[i]).map((i: string) => parts[i]);
  const env = new nunjucks.Environment(new MemLoader({ _macros: D.catalog.macros, doc: '{% import "_macros" as m with context %}\n' + tpl.body }),
    { autoescape: true, throwOnUndefined: false, trimBlocks: true, lstripBlocks: true });
  env.addFilter("ddmmyyyy", fmtDate);
  env.addFilter("date_long", fmtDateLong);
  env.addFilter("date_text", fmtDateText);
  let html = env.render("doc", { v, vc, vl, has, raw, pv, pval, plist, case: caseSnap, fmt_date: fmtDate, fmt_date_long: fmtDateLong, fmt_date_text: fmtDateText });
  html = html.replace(/\n\s*\n+/g, "\n").trim();
  return { html, missing };
}

// --- правовые ссылки ---
const RE_REF = /(?:(?:п(?:\.|ункт[аеу]?)\s*[«"]?([а-я0-9]{1,3})[»"]?\s*)?)(?:(?:ч(?:\.|аст[иью])\s*(\d{1,2}(?:\.\d)?)\s*(?:и\s*\d{1,2}\s*)?))?(?:ст(?:\.|ать(?:и|ей|ям|ями|ях|ья|ю))\s*((?:\d{1,3}(?:\.\d{1,2})?(?:\s*[–—-]\s*\d{1,3})?(?:\s*,\s*|\s+и\s+)?)+))\s*(УПК\s*РФ|УК\s*РФ|Уголовно-процессуального\s+кодекса|Уголовного\s+кодекса|Конституции\s+(?:РФ|Российской\s+Федерации)|КоАП\s*РФ)/gi;
export function findReferences(text: string) {
  const out: any[] = [];
  for (const m of text.matchAll(RE_REF)) {
    const raw = m[4].toLowerCase();
    const code = raw.includes("упк") || raw.includes("процессуальн") ? "upk" : raw.includes("коап") ? "koap" : raw.includes("конституц") ? "konst" : "uk";
    for (const part of m[3].trim().split(/\s*,\s*|\s+и\s+/)) {
      if (!part.trim()) continue;
      const rng = /^(\d{1,3})\s*[–—-]\s*(\d{1,3})$/.exec(part.trim());
      const arts = rng && Number(rng[2]) - Number(rng[1]) < 30 ? Array.from({ length: Number(rng[2]) - Number(rng[1]) + 1 }, (_, i) => String(Number(rng[1]) + i)) : [part.trim()];
      arts.forEach((a) => out.push({ text: m[0], act: code, article: a, key: `${code}:${a}`, start: m.index!, end: m.index! + m[0].length }));
    }
  }
  return out;
}
export const PROVISIONS: Record<string, any> = Object.fromEntries(D.legal.provisions.map((p: any) => [p.key, p]));
export function provisionStatus(key: string) {
  const p = PROVISIONS[key];
  if (!p) return { status: "missing", verified: false, message: "Норма отсутствует в правовом справочнике; ссылка не проверена" };
  return { status: "text_missing", verified: false, message: `Текст ст. ${p.article} ${p.act} не загружен из официального источника; актуальность не подтверждена` };
}
export const provLabel = (key: string) => {
  const p = PROVISIONS[key];
  if (p) return `ст. ${p.article} ${p.act}`;
  const [c, a] = key.split(":");
  return `ст. ${a} ${({ upk: "УПК РФ", uk: "УК РФ", konst: "Конституции РФ", koap: "КоАП РФ" } as any)[c] ?? c}`;
};

export function htmlToText(html: string) {
  const d = document.createElement("div");
  d.innerHTML = html.replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|h1|h2|h3|tr|li|div)>/g, "$&\n");
  return d.textContent ?? "";
}

// --- проверка документа ---
export function validate(doc: any, version: any, tpl: any, c: any, ctx: { facts: any[]; participants: any[] }) {
  const items: any[] = [];
  const legal: any[] = [];
  const it = (level: string, code: string, message: string, extra: any = {}) => items.push({ level, code, message, ...extra });
  const values = version.field_values ?? {};
  const sources = version.field_sources ?? {};
  const html = version.content_html ?? "";
  const docDate = toDate(values.doc_date) ?? new Date();
  if (tpl) {
    for (const f of tpl.fields) {
      const val = values[f.key];
      if (conditionHolds(f.condition, values) && f.required && !filled(val)) it("error", "required_field", `Не заполнено обязательное поле «${f.label}»`, { field: f.key });
    }
    if (tpl.stages?.length && !tpl.stages.includes(c.stage)) it("warning", "stage", `Вид документа не предусмотрен для текущей стадии производства по карточке дела (${c.stage}). Проверьте процессуальную допустимость.`);
    if (tpl.procedural_kind === "head_resolution") it("info", "author", `Документ выносится и подписывается: ${tpl.author_role}.`);
    if (tpl.requires_court) it("info", "court", "Для производства действия (применения меры) требуется судебное решение.");
    if (tpl.requires_head_consent) it("info", "consent", "Требуется согласие руководителя следственного органа.");
    (tpl.warnings ?? []).forEach((w: string) => it("info", "template_warning", w));
    for (const [k, map] of Object.entries(tpl.value_warnings ?? {})) { const msg = (map as any)[String(values[k])]; if (msg) it("warning", "special_procedure", msg, { field: k }); }
    for (const [k, map] of Object.entries(tpl.value_errors ?? {})) { const msg = (map as any)[String(values[k])]; if (msg) it("error", "special_procedure", msg, { field: k }); }
  }
  for (const m of html.matchAll(/<span class="gap" data-field="([^"]*)" data-required="([01])">/g))
    it(m[2] === "1" ? "error" : "warning", "gap", `В тексте остался незаполненный фрагмент: ${m[1]}`, { field: m[1] });
  for (const m of html.matchAll(/<span class="fv ai"[^>]*data-field="([^"]*)"/g))
    it("error", "ai_unconfirmed", "Фрагмент, сформированный ИИ, не подтверждён пользователем (проектная формулировка)", { field: m[1] });
  for (const [k, s] of Object.entries<any>(sources)) {
    if ((s.type === "ai" || s.type === "assist") && !s.confirmed && !items.some((i) => i.code === "ai_unconfirmed" && i.field === k))
      it("error", "ai_unconfirmed", "Значение поля сформировано ИИ и не подтверждено пользователем", { field: k });
    if (s.type === "fact") {
      const f = ctx.facts.find((x) => x.id === s.id);
      if (!f) it("error", "fact_missing", "Источник факта не найден в досье", { field: k });
      else if (f.status === "rejected") it("error", "fact_rejected", "Использован факт, отклонённый при проверке", { field: k });
      else if (f.status !== "confirmed") it("warning", "fact_unverified", "Использован факт, не подтверждённый пользователем", { field: k });
    }
    if (s.type === "system") it("warning", "system_value", `Значение подставлено автоматически (${s.label}) и требует проверки`, { field: k });
  }
  if (tpl) for (const f of tpl.fields) {
    const val = values[f.key];
    const ids = f.type === "participant" && typeof val === "string" && val ? [val] : f.type === "participants" && Array.isArray(val) ? val : [];
    for (const pid of ids) {
      const p = ctx.participants.find((x) => x.id === pid);
      if (!p) { it("error", "participant_missing", `Участник в поле «${f.label}» не найден в деле`, { field: f.key }); continue; }
      if (p.is_archived) it("warning", "participant_archived", `Участник «${p.display_name}» архивирован`, { field: f.key });
      if (f.participant_role && !f.participant_role.split("|").includes(p.role)) it("warning", "participant_role", `Процессуальное положение «${p.display_name}» не соответствует полю «${f.label}»`, { field: f.key });
    }
  }
  const today = new Date(); today.setHours(23, 59, 59);
  if (docDate > today) it("warning", "future_date", "Дата документа позднее текущей даты");
  const opened = toDate(c.opened_at);
  if (opened && tpl && !(tpl.stages ?? []).includes("check") && docDate < opened) it("error", "before_opening", "Дата документа предшествует дате возбуждения уголовного дела");
  if (values.time_start && values.time_end && String(values.time_end) <= String(values.time_start)) it("warning", "time_order", "Время окончания не позднее времени начала (проверьте, не переходит ли действие на следующие сутки)");
  if (values.case_number && c.case_number && String(values.case_number).trim() !== c.case_number.trim()) it("warning", "case_number", `Номер дела в документе (${values.case_number}) не совпадает с карточкой (${c.case_number})`);
  for (const lb of tpl?.legal_bases ?? []) legal.push({ key: lb.key, source: "template", reason: lb.reason, mandatory: lb.mandatory ?? true, ...provisionStatus(lb.key), label: provLabel(lb.key) });
  const seen = new Set(legal.map((l) => l.key));
  for (const ref of findReferences(htmlToText(html))) {
    if (seen.has(ref.key)) continue;
    seen.add(ref.key);
    legal.push({ key: ref.key, source: "text", reason: `Ссылка в тексте: «${ref.text}»`, mandatory: false, ...provisionStatus(ref.key), label: provLabel(ref.key) });
  }
  legal.filter((l) => l.status === "missing").forEach((l) => it("warning", "legal_missing", `Ссылка на ${l.label} отсутствует в правовом справочнике и не проверена`));
  const unverified = legal.filter((l) => !l.verified);
  if (unverified.length) it("warning", "legal_unverified", `Актуальность ${unverified.length} правовых ссылок не подтверждена (редакция не загружена или не верифицирована)`);
  it("info", "registry_date", "Демонстрационная версия: тексты норм в справочник не загружены. Изменения законодательства не проверены.");
  const errors = items.filter((i) => i.level === "error").length;
  return { checked_at: new Date().toISOString(), version_id: version.id,
    summary: { errors, warnings: items.filter((i) => i.level === "warning").length, legal_total: legal.length, legal_verified: legal.length - unverified.length },
    items, legal, disclaimer: "Автоматическая проверка не подтверждает юридическую корректность документа. Требуется проверка уполномоченным лицом." };
}

// --- сроки ---
function addMonths(d: Date, n: number) {
  const m = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(y, mm + 1, 0).getDate();
  return new Date(y, mm, Math.min(d.getDate(), last));
}
const fmtDT = (d: Date) => `${fmtDate(isoDate(d))} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
export function computeDeadline(ruleCode: string, startIso: string, params: any = {}, adjustments: any[] = [], holidays: string[] = []) {
  const rule = D.deadline_rules.find((r: any) => r.code === ruleCode);
  const unit = params.unit ?? rule.unit;
  const amount = Number(params.amount ?? rule.amount);
  const inc = params.include_start_day ?? rule.include_start_day;
  const shift = params.shift_nonworking ?? rule.shift_nonworking;
  const start = new Date(startIso);
  const steps = [`Исходная дата и время: ${fmtDT(start)}`];
  let due: Date;
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59);
  if (unit === "hours") { due = new Date(start.getTime() + amount * 3600e3); steps.push(`Срок в часах: ${amount} ч от исходного момента`); }
  else {
    const base = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let end: Date;
    if (unit === "days") {
      if (amount >= 0) { end = new Date(base); end.setDate(end.getDate() + amount - (inc ? 1 : 0)); steps.push(`Срок в сутках: ${amount}; сутки начала течения срока ${inc ? "учитываются" : "не учитываются (ч. 1 ст. 128 УПК РФ)"}`); }
      else { end = new Date(base); end.setDate(end.getDate() + amount); steps.push(`Не позднее ${-amount} суток до исходной даты`); }
    } else { end = addMonths(base, amount); if (inc) end.setDate(end.getDate() - 1); steps.push(`Срок в месяцах: ${amount}; начальный день ${inc ? "включается" : "не включается"}`); }
    due = endOfDay(end);
  }
  for (const a of adjustments) if (a.type === "extension") {
    if (a.new_due) { due = endOfDay(toDate(a.new_due)!); steps.push(`Продление до ${fmtDate(a.new_due)} (${a.basis || "основание не указано"})`); }
    else if (a.months) { const e = addMonths(new Date(start.getFullYear(), start.getMonth(), start.getDate()), Number(a.months)); if (inc) e.setDate(e.getDate() - 1); due = endOfDay(e); steps.push(`Продление: общий срок ${a.months} мес. (${a.basis || "основание не указано"})`); }
    else if (a.days) { due = new Date(due.getTime() + Number(a.days) * 864e5); steps.push(`Продление на ${a.days} сут.`); }
  }
  for (const a of adjustments) if (a.type === "suspension" && a.from) {
    if (!a.to) { steps.push(`Производство приостановлено с ${fmtDate(a.from)}; течение срока прервано`); return { due_at: null, steps, suspended: true, rule: ruleCode, basis: rule.basis, basis_key: rule.basis_key, note: rule.note }; }
    const days = Math.round((toDate(a.to)!.getTime() - toDate(a.from)!.getTime()) / 864e5);
    due = new Date(due.getTime() + days * 864e5);
    steps.push(`Время приостановления ${fmtDate(a.from)}–${fmtDate(a.to)} (${days} сут.) не включается в срок`);
  }
  if (shift && unit !== "hours") {
    let n = 0;
    while (due.getDay() === 0 || due.getDay() === 6 || holidays.includes(isoDate(due))) { due = new Date(due.getTime() + 864e5); n++; }
    if (n) steps.push(`Окончание срока приходится на нерабочий день — перенос на ${fmtDate(isoDate(due))} (ч. 2 ст. 128 УПК РФ)`);
    if (!holidays.length) steps.push("Календарь праздничных нерабочих дней не заполнен: учтены только суббота и воскресенье");
  }
  steps.push(`Итоговая дата: ${fmtDT(due)}`);
  return { due_at: due.toISOString(), steps, suspended: false, rule: ruleCode, basis: rule.basis, basis_key: rule.basis_key, note: rule.note,
    params: { unit, amount, include_start_day: inc, shift_nonworking: shift } };
}

// --- подбор вида документа ---
const STOP = new Set(["и", "в", "о", "об", "по", "на", "с", "со", "к", "для", "из", "от", "что", "как", "это", "нужно", "надо", "необходимо", "подготовить", "составить", "сделать", "оформить", "документ", "прошу", "мне", "нам"]);
const stems = (t: string) => new Set((t.toLowerCase().replace(/ё/g, "е").match(/[а-яa-z0-9]+/g) ?? []).filter((w) => !STOP.has(w) && w.length > 2).map((w) => w.slice(0, 6)));
export function suggest(task: string, stage: string) {
  const q = stems(task);
  const scored: [number, any][] = [];
  for (const t of D.catalog.templates) {
    const ts = stems(t.title);
    const ks = new Set<string>();
    t.keywords.forEach((k: string) => stems(k).forEach((s) => ks.add(s)));
    let score = 0;
    q.forEach((w) => { if (ks.has(w)) score += 2; if (ts.has(w)) score += 1; });
    t.keywords.forEach((k: string) => { if (task.toLowerCase().includes(k.toLowerCase())) score += 3; });
    if (t.stages?.includes(stage)) score += 0.5;
    if (score > 0) scored.push([score, t]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title));
  return scored.slice(0, 5).map(([s, t]) => ({ code: t.code, title: t.title, score: s, method: "rules" }));
}

// --- извлечение (упрощённый перенос правил для TXT/CSV) ---
const MRE = MONTHS.join("|");
export function extractEntities(text: string) {
  const out: any[] = [];
  const ctx = (s: number, e: number) => (s > 90 ? "…" : "") + text.slice(Math.max(0, s - 90), Math.min(text.length, e + 90)).trim() + (e + 90 < text.length ? "…" : "");
  const add = (type: string, m: RegExpMatchArray, norm: string | null, val?: string) => out.push({ type, value: (val ?? m[0]).trim(), normalized: norm, start: m.index!, end: m.index! + m[0].length, context: ctx(m.index!, m.index! + m[0].length) });
  const kind = (s: number, e: number) => {
    const after = text.slice(e, e + 25), before = text.slice(Math.max(0, s - 30), s);
    if (/^\s*(г\.\s*р\.|года\s+рождения)/i.test(after) || /(дата\s+рождения|родил(ся|ась))\s*[:\-–]?\s*$/i.test(before)) return "birth_date";
    if (/(\bот|выдан[аоы]?)\s*$/i.test(before)) return "date";
    const sentence = text.slice(Math.max(0, s - 150), e + 150);
    return /(совершил|произош|похитил|похищен|нанес|нанёс|проник|завладел|причинил|находясь)/i.test(sentence) ? "incident_date" : "date";
  };
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.]\d)/g)) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (d.getDate() === Number(m[1])) add(kind(m.index!, m.index! + m[0].length), m, isoDate(d));
  }
  for (const m of text.matchAll(new RegExp(`(\\d{1,2})\\s+(${MRE})\\s+(\\d{4})`, "gi"))) {
    const d = new Date(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()), Number(m[1]));
    add(kind(m.index!, m.index! + m[0].length), m, isoDate(d));
  }
  for (const m of text.matchAll(/([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+(?:ович|евич|ич|овна|евна|ична|инична)(?:а|у|ем|е|ой|ы|ом)?)(?![а-яё])/g))
    add("person", m, `${m[1].toLowerCase()}|${m[2][0]}|${m[3][0]}`);
  for (const m of text.matchAll(/(?<!\d)(?:\+7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g))
    add("phone", m, "+7" + m[0].replace(/\D/g, "").slice(-10));
  for (const m of text.matchAll(/(уголовно(?:е|го|му|м)\s+дел[оау]?|КУСП)\s*№\s*([0-9][0-9\-/]{2,30})/gi))
    add("case_number", m, `${m[1].toLowerCase().includes("кусп") ? "kusp" : "case"}:${m[2]}`);
  for (const m of text.matchAll(/(?<![\d,])(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(руб(?:\.|л(?:ей|я|ь))?|₽)/gi))
    add("money", m, `${Number(m[1].replace(/\s/g, ""))}.${(m[2] ?? "00").padEnd(2, "0")}`);
  for (const r of findReferences(text)) out.push({ type: "legal_ref", value: r.text, normalized: r.key, start: r.start, end: r.end, context: ctx(r.start, r.end) });
  return out.sort((a, b) => a.start - b.start);
}

// --- сравнение версий ---
export function lineDiff(a: string[], b: string[]) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: any[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "removed", text: a[i++] });
    else out.push({ op: "added", text: b[j++] });
  }
  while (i < n) out.push({ op: "removed", text: a[i++] });
  while (j < m) out.push({ op: "added", text: b[j++] });
  return out;
}
