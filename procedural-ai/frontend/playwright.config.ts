import { defineConfig } from "@playwright/test";

// Сквозные тесты интерфейса. Требуют запущенного сервера с демонстрационными данными
// (scripts/seed_demo.py). Адрес задаётся переменной PAI_E2E_URL.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.PAI_E2E_URL ?? "http://127.0.0.1:8000",
    launchOptions: process.env.PAI_CHROMIUM ? { executablePath: process.env.PAI_CHROMIUM } : {},
    screenshot: "only-on-failure",
    // Для тестового стенда с внутренним ЦС Caddy, корневой сертификат которого не установлен
    ignoreHTTPSErrors: process.env.PAI_E2E_INSECURE === "1",
  },
  reporter: [["list"]],
});
