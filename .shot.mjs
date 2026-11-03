import { chromium } from "playwright";
import fs from "node:fs";
const patch = fs.readFileSync("/tmp/sample.txt", "utf8");
const out = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const p = await b.newPage({ viewport: { width: 1000, height: 560 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.addInitScript((patch) => {
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "x" } }, invoke: async (cmd) => cmd === "get_project_diff" ? { displayName: "asurada", path: "/tmp/x", patch, untracked: [] } : null, transformCallback: () => 1 };
}, patch);
await p.goto("http://localhost:4799/?view=diff&id=abc");
await p.waitForSelector(".dw-file");
await p.waitForTimeout(2500);
await p.screenshot({ path: out, clip: { x: 260, y: 52, width: 740, height: 500 } });
await b.close();
