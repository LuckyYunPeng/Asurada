#!/usr/bin/env node
/**
 * Theme preview shots for PR review (dev server + ?capture=).
 * Usage: npm run dev &  node scripts/capture-theme-preview.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "artifacts");
const baseUrl = process.env.CAPTURE_BASE_URL ?? "http://localhost:4721";

const shots = [
  {
    file: "theme-settings-light.png",
    capture: "settings",
    theme: "light",
  },
  {
    file: "theme-settings-dark.png",
    capture: "settings",
    theme: "dark",
  },
  {
    file: "theme-list-dark.png",
    capture: "list",
    theme: "dark",
  },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const { capture, file, theme } of shots) {
  const context = await browser.newContext({
    viewport: { width: 400, height: 820 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript((pref) => {
    localStorage.setItem("asurada_theme", pref);
  }, theme);

  const url = `${baseUrl}/?capture=${encodeURIComponent(capture)}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".panel", { timeout: 15000 });
  await page.waitForTimeout(500);

  if (capture === "settings") {
    await page.waitForSelector(".settings-page", { timeout: 5000 });
  }
  if (capture === "list") {
    await page.waitForSelector(".risk", { timeout: 5000 });
  }

  const desktop = page.locator(".desktop");
  await desktop.screenshot({ path: path.join(outDir, file) });
  console.log("wrote", path.join("artifacts", file));
  await context.close();
}

await browser.close();
