import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173";
const base = new URL(baseURL);
const hostname = base.hostname;
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) {
  throw new Error("Receipt repair Playwright tests only allow a local app URL.");
}
if (base.pathname !== "/") {
  throw new Error("PLAYWRIGHT_BASE_URL must point to the local app root.");
}
const receiptFixtureKeys = [
  "E2E_FINANCE_EMAIL",
  "E2E_FINANCE_PASSWORD",
  "E2E_RECEIPT_REF",
  "E2E_RECEIPT_NO",
  "E2E_STUDENT_SEARCH",
  "E2E_STUDENT_ADMISSION_NO",
];
const receiptFixtureConfigured = receiptFixtureKeys.some((key) => !!process.env[key]);
if (receiptFixtureConfigured) {
  const appEnv = loadEnv("development", process.cwd(), "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL || appEnv.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Receipt repair E2E requires a local Supabase URL.");
  const supabaseHost = new URL(supabaseUrl).hostname;
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(supabaseHost)) {
    throw new Error("Receipt repair E2E tests only allow a local Supabase endpoint.");
  }
}
const port = base.port || "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
