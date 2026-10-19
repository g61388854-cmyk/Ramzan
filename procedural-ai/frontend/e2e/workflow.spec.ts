import { expect, test, type Page } from "@playwright/test";

const LOGIN = process.env.PAI_E2E_LOGIN ?? "demo.investigator";
const PASSWORD = process.env.PAI_E2E_PASSWORD ?? "Demo-Pass-2026";
const SHOTS = process.env.PAI_E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function login(page: Page) {
  await page.goto("./");
  await page.getByLabel("Логин").fill(LOGIN);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
  // При первом входе система предлагает сменить пароль — в тесте окно закрывается
  const dlg = page.getByRole("dialog", { name: "Смена пароля" });
  await page.waitForTimeout(300);
  if (await dlg.isVisible().catch(() => false)) await dlg.getByRole("button", { name: "Отмена" }).click();
}

test("основной сценарий: дело → материалы → факты → документ → проверка → экспорт", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await login(page);
  await expect(page.getByRole("heading", { name: "Главная панель" })).toBeVisible();
  await shot(page, "01-dashboard");

  await page.getByRole("link", { name: "Уголовные дела" }).click();
  await page.getByRole("cell", { name: "12601690001000045" }).first().click();
  await expect(page.getByRole("heading", { name: /Уголовное дело/ })).toBeVisible();
  await shot(page, "02-case-general");

  await page.getByRole("tab", { name: /Материалы/ }).click();
  await expect(page.getByText("И1_заявление.txt")).toBeVisible();
  await page.getByText("И1_заявление.txt").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "03-source-viewer");
  await page.getByRole("button", { name: "Закрыть" }).click();

  await page.getByRole("tab", { name: /Факты/ }).click();
  await shot(page, "04-facts");
  const confirmButtons = page.getByRole("button", { name: "Подтвердить" });
  await confirmButtons.first().click();

  await page.getByRole("tab", { name: /Расхождения/ }).click();
  await expect(page.getByText(/потенциальные/i).first()).toBeVisible();
  await shot(page, "05-discrepancies");

  await page.getByRole("tab", { name: /Документы/ }).click();
  await page.getByRole("button", { name: "Сформировать документ" }).click();
  await page.getByPlaceholder("Поиск по наименованию или ключевым словам").fill("принятии уголовного дела");
  await page.getByRole("dialog").getByRole("button", { name: "Сформировать", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /принятии уголовного дела/ })).toBeVisible();
  await shot(page, "06-workspace-form");

  await page.getByLabel(/Основание поступления уголовного дела/).fill("Уголовное дело поручено руководителем следственного отдела (синтетические данные).");
  await page.getByRole("button", { name: /Сохранить версию/ }).click();
  await expect(page.getByText(/^версия 2 · шаблон/)).toBeVisible();
  await page.getByRole("tab", { name: "Текст документа" }).click();
  await expect(page.locator(".paper")).toContainText("ПОСТАНОВЛЕНИЕ");
  await shot(page, "07-workspace-text");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOCX", exact: true }).click();
  // Содержимое — документ Office Open XML (сигнатура ZIP). Имя файла не проверяется:
  // headless-сборка Chromium заменяет кириллические имена blob-загрузок на «download».
  const fs = await import("node:fs");
  const file = await (await download).path();
  if (process.env.PAI_E2E_DEMO === "1") expect(fs.readFileSync(file!).toString()).toContain("ПОСТАНОВЛЕНИЕ");
  else expect(fs.readFileSync(file!).subarray(0, 2).toString()).toBe("PK");

  await page.getByRole("link", { name: "Правовой справочник" }).click();
  await expect(page.getByText(/Дата последнего обновления справочника/)).toBeVisible();
  await shot(page, "08-legal");
  await page.getByRole("link", { name: "Сроки и календарь" }).click();
  await shot(page, "09-deadlines");
  await page.getByRole("link", { name: "Каталог документов" }).click();
  await expect(page.getByText(/Видов документов/)).toBeVisible();
  await shot(page, "10-catalog");

  expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
});

test("мобильная ширина: панели рабочего места переключаются вкладками", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await login(page);
  await page.goto("./#/cases");
  await page.getByRole("cell", { name: "12601690001000045" }).first().click();
  await page.getByRole("tab", { name: /Документы/ }).click();
  await page.locator("table.t tbody tr").first().click();
  await expect(page.getByRole("button", { name: "Проверка и источники" })).toBeVisible();
  await page.getByRole("button", { name: "Проверка и источники" }).click();
  await expect(page.getByText("Результаты проверки")).toBeVisible();
  await shot(page, "11-mobile");
});
