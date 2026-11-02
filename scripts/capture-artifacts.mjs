#!/usr/bin/env node
/**
 * Dev-only: capture Asurada UI frames via ?capture= query (see src/captureMode.ts).
 * Usage: npm run dev (port 4721) + node scripts/capture-artifacts.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "artifacts");
const baseUrl = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:4721";

const shots = [
  { capture: "intro-1", file: "intro-1.png" },
  { capture: "intro-2", file: "intro-2.png" },
  { capture: "intro-3", file: "intro-3.png" },
  { capture: "precheck", file: "precheck.png" },
  { capture: "precheck-fail", file: "precheck-fail.png" },
  { capture: "list", file: "list.png" },
  { capture: "empty", file: "empty.png" },
  { capture: "running", file: "running.png" },
  { capture: "result", file: "result.png" },
  { capture: "settings", file: "settings-shortcut.png" },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 960, height: 720 },
  deviceScaleFactor: 2,
});

for (const { capture, file } of shots) {
  const url = `${baseUrl}/?capture=${encodeURIComponent(capture)}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".panel", { timeout: 15000 });
  await page.waitForTimeout(400);
  const panel = page.locator(".desktop");
  await panel.screenshot({
    path: path.join(outDir, file),
  });
  console.log("wrote", path.join("artifacts", file));
}

await browser.close();
