// Repository rules: zero runtime dependencies, nothing host-specific, no HTML injection APIs, CSS in sync.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = readdirSync(ROOT + "src").map((f) => ["src/" + f, readFileSync(ROOT + "src/" + f, "utf8")]);
function files(dir, out = []) {
  for (const f of readdirSync(ROOT + dir)) {
    if (f === ".git" || f === "node_modules") continue;
    const p = dir ? `${dir}/${f}` : f;
    if (statSync(ROOT + p).isDirectory()) files(p, out); else out.push(p);
  }
  return out;
}

test("src: the expected modules exist", () => {
  const names = SRC.map(([p]) => p).sort();
  for (const m of ["core", "export", "layout", "mindmap", "model", "ops", "outline", "svg"]) assert.ok(names.includes(`src/${m}.js`), m);
  assert.ok(names.includes("src/mindmap.css"));
});

test("src: no HTML-string APIs, no eval, no network", () => {
  for (const [p, s] of SRC) {
    for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "fetch(", "XMLHttpRequest", "WebSocket", "@import", "url(http"]) {
      assert.ok(!s.includes(bad), `${p} uses ${bad}`);
    }
  }
});

test("src: imports are relative to src only (zero runtime dependencies)", () => {
  for (const [p, s] of SRC) for (const m of s.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']/g)) assert.ok(m[1].startsWith("./"), `${p} imports ${m[1]}`);
  const pkg = JSON.parse(readFileSync(ROOT + "package.json", "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.license, "MIT");
});

test("src: ASCII only (every visible string is English and goes through `strings`)", () => {
  for (const [p, s] of SRC) assert.ok(!/[^\t\n\x20-\x7e]/.test(s), p);
});

test("repo: nothing host-specific (no product names, machine paths)", () => {
  // Built from parts so that this file does not match itself.
  const banned = [["ra", "bbit"], ["fa", "rmi"]].map(([a, b]) => new RegExp(a + b, "i")).concat([new RegExp("/" + "Users/"), new RegExp("/" + "home/[a-z]")]);
  for (const p of files("")) {
    if (/\.(png|jpg)$/.test(p)) continue;
    const s = readFileSync(ROOT + p, "utf8");
    for (const re of banned) assert.ok(!re.test(s), `${p} matches ${re}`);
  }
});

test("LICENSE is MIT", () => {
  assert.equal(readFileSync(ROOT + "LICENSE", "utf8").split("\n")[0], "MIT License");
});

test("src/mindmap.css and the CSS injected by src/mindmap.js are identical", () => {
  const out = execFileSync(process.execPath, [ROOT + "test/tools/sync-css.mjs", "--check"], { encoding: "utf8" });
  assert.match(out, /css in sync/);
});

// Font stacks: only the system fonts every host may show without shipping or downloading anything. A value is either
// exactly one of these two lists or a var(...) reference / CSS-wide keyword.
const SANS = '-apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
test("src: font stacks are exactly the system font lists (CSS, the CSS string in mindmap.js, JS constants)", () => {
  const found = [];
  for (const [p, raw] of SRC) {
    const text = raw.replace(/\\"/g, '"'); // the CSS inside mindmap.js is a JSON string
    const take = (re, group) => { for (const m of text.matchAll(re)) found.push([p, m[group].trim()]); };
    take(/font-family\s*:\s*([^;}\n]+)/g, 1);
    take(/--[\w-]*(?:font|mono)[\w-]*\s*:\s*([^;}\n]+)/g, 1);
    take(/\b(?:FONT|MONO)\s*=\s*(['"`])(.*?)\1/g, 2);
    take(/"font-family"\s*:\s*(['"`])(.*?)\1/g, 2);
  }
  const lists = found.filter(([, v]) => !/^var\(/.test(v) && !/^(inherit|initial|unset|revert)$/.test(v));
  const bad = lists.filter(([, v]) => v !== SANS && v !== MONO);
  assert.deepEqual(bad, [], "font values outside the system lists");
  // svg.js FONT + MONO, mindmap.css --mmd-font + --mmd-mono, and the same two inside mindmap.js: a scan that finds fewer is broken.
  assert.ok(lists.length >= 6, `only ${lists.length} font lists found: ${JSON.stringify(lists)}`);
});
