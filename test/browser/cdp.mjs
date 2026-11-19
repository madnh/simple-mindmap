// A minimal Chrome DevTools Protocol driver: launches headless Chrome, opens a page, evaluates code and
// sends REAL input events (Input.dispatchMouseEvent / dispatchKeyEvent). Zero dependencies (node:child_process,
// global WebSocket of node >= 22).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);
export function findChrome() { return CANDIDATES.find((p) => existsSync(p)) || null; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const bin = findChrome();
  if (!bin) throw new Error("Chrome not found: set CHROME=/path/to/chrome");
  const profile = mkdtempSync(join(tmpdir(), "smm-chrome-"));
  const proc = spawn(bin, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1200,800", "about:blank"], { stdio: "ignore" });
  let port = null;
  for (let i = 0; i < 200 && !port; i++) {
    await sleep(50);
    try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); } catch { /* not yet */ }
  }
  if (!port) { proc.kill(); throw new Error("Chrome did not start"); }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
    else if (msg.method) for (const h of handlers) h(msg);
  };
  // every command fails after 20 s instead of hanging the run
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP ${method} timed out`)); }, 20000);
    pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const consoleLines = [];
  handlers.push((m) => {
    if (m.method === "Runtime.consoleAPICalled") consoleLines.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") consoleLines.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  const page = {
    console: consoleLines,
    async goto(url) {
      const loaded = new Promise((r) => { const h = (m) => { if (m.method === "Page.loadEventFired") { handlers.splice(handlers.indexOf(h), 1); r(); } }; handlers.push(h); });
      await send("Page.navigate", { url });
      await loaded;
    },
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, ms = 5000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await page.eval(expr)) return true; await sleep(25); }
      throw new Error("timeout waiting for " + expr);
    },
    async mouse(type, x, y, extra = {}) { await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra }); },
    async click(x, y, clickCount = 1) {
      await page.mouse("mouseMoved", x, y, { buttons: 0, button: "none" });
      await page.mouse("mousePressed", x, y, { clickCount });
      await page.mouse("mouseReleased", x, y, { clickCount });
    },
    async dblclick(x, y) { await page.click(x, y, 1); await page.click(x, y, 2); },
    async drag(x0, y0, x1, y1, steps = 8) {
      await page.mouse("mouseMoved", x0, y0, { buttons: 0, button: "none" });
      await page.mouse("mousePressed", x0, y0);
      for (let i = 1; i <= steps; i++) await page.mouse("mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await page.mouse("mouseReleased", x1, y1);
    },
    async wheel(x, y, deltaX, deltaY, modifiers = 0) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY, modifiers }); },
    async key(key, { modifiers = 0, code, text, keyCode } = {}) {
      const kc = keyCode ?? { Enter: 13, Escape: 27, Tab: 9, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, F2: 113, Delete: 46, Backspace: 8, " ": 32 }[key] ?? key.toUpperCase().charCodeAt(0);
      const base = { key, code: code || (key.length === 1 ? `Key${key.toUpperCase()}` : key), windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, modifiers };
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
    async type(s) { for (const ch of s) await send("Input.insertText", { text: ch }); },
    async screenshot(path) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    async close() { try { await send("Browser.close"); } catch { /* gone */ } ws.close(); proc.kill(); await sleep(100); rmSync(profile, { recursive: true, force: true }); },
  };
  return page;
}
