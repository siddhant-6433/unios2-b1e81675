// Visual QA harness for the /pay/:token public page (and route guards) —
// drives the local vite dev server with Playwright and MOCKS the Supabase
// functions endpoint (the dev server has no .env, so the client points at
// placeholder.supabase.co; nothing can reach production).
//
// Usage: node scripts/qa-paylink-visual.mjs [baseUrl]
// Screenshots land in /tmp/qa-paylink/.

import { chromium } from "playwright-core";
import { mkdirSync } from "fs";

const BASE = process.argv[2] || "http://localhost:5199";
const OUT = "/tmp/qa-paylink";
mkdirSync(OUT, { recursive: true });

const LINK_STATES = {
  active: {
    payer_name: "Asha Verma",
    amount: 5000,
    purpose: "pre_admission_token",
    purpose_label: "Token fee prior to admission",
    note: "Seat booking for B.Sc Nursing",
    status: "active",
    gateway: null,
    short_url: null,
  },
  paid: { payer_name: "Asha Verma", amount: 5000, purpose: "custom", purpose_label: "Payment", note: null, status: "paid", gateway: null, short_url: null },
  expired: { payer_name: "Asha Verma", amount: 5000, purpose: "custom", purpose_label: "Payment", note: null, status: "expired", gateway: null, short_url: null },
};

const consoleErrors = [];

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`shot: ${OUT}/${name}.png`);
}

async function run() {
  const browser = await chromium.launch();
  const results = [];

  for (const [state, payload] of Object.entries(LINK_STATES)) {
    for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport });
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(`[${state}/${label}] ${msg.text()}`);
      });
      await page.route("**/functions/v1/pay-link", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }),
      );
      await page.goto(`${BASE}/pay/qa-token-123`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      await shot(page, `paylink-${state}-${label}`);

      const text = await page.textContent("body");
      if (state === "active") {
        results.push([`active/${label}: shows amount`, text.includes("₹5,000")]);
        results.push([`active/${label}: shows payer`, text.includes("Asha Verma")]);
        results.push([`active/${label}: shows purpose`, text.includes("Token fee prior to admission")]);
        results.push([`active/${label}: pay button`, (await page.locator("button:has-text('Pay ₹5,000')").count()) === 1]);
      }
      if (state === "paid") {
        results.push([`paid/${label}: done state`, text.includes("Payment received")]);
        results.push([`paid/${label}: no pay button`, (await page.locator("button:has-text('Pay')").count()) === 0]);
      }
      if (state === "expired") {
        results.push([`expired/${label}: blocked`, text.includes("This link is expired.")]);
      }
      await page.close();
    }
  }

  // Route guards: /visit-center unauthenticated must never render the page.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/visit-center`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const url = page.url();
  const body = (await page.textContent("body")) || "";
  results.push([
    "guard: /visit-center unauthenticated does not render Visit Center",
    !body.includes("Record Walk-in"),
  ]);
  console.log(`guard: /visit-center landed on ${url}`);
  await shot(page, "visit-center-unauthed");
  await page.close();

  await browser.close();

  let failed = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
    if (!ok) failed++;
  }
  const realErrors = consoleErrors.filter(
    (e) => !/placeholder\.supabase\.co|Failed to load resource|net::ERR/i.test(e),
  );
  if (realErrors.length) {
    console.log("CONSOLE ERRORS (non-network):");
    realErrors.forEach((e) => console.log("  " + e));
  } else {
    console.log("no non-network console errors");
  }
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
