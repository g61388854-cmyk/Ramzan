export function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? v + "T00:00:00" : v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString("ru-RU");
}

export function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function daysLeft(v?: string | null): number | null {
  if (!v) return null;
  return Math.floor((new Date(v).getTime() - Date.now()) / 86400000);
}

export const STATUS_TONE: Record<string, string> = {
  draft: "neutral",
  awaiting_input: "warn",
  analyzing: "info",
  needs_review: "warn",
  reviewed: "ok",
  approved: "ok",
  exported: "info",
  archived: "muted",
};

export const FILE_STATUS: Record<string, [string, string]> = {
  uploaded: ["Загружен", "neutral"],
  processing: ["Обрабатывается", "info"],
  processed: ["Обработан", "ok"],
  partially_processed: ["Обработан частично", "warn"],
  needs_ocr: ["Требуется OCR", "warn"],
  stored: ["Сохранён без текста", "muted"],
  failed: ["Ошибка обработки", "danger"],
};

export const FACT_STATUS: Record<string, [string, string]> = {
  unverified: ["Не проверен", "warn"],
  confirmed: ["Подтверждён", "ok"],
  rejected: ["Отклонён", "danger"],
};

export const LEGAL_STATUS: Record<string, [string, string]> = {
  verified: ["Проверено", "ok"],
  unverified: ["Не верифицировано", "warn"],
  text_missing: ["Текст не загружен", "warn"],
  no_version: ["Нет редакции на дату", "danger"],
  missing: ["Нет в справочнике", "danger"],
};
