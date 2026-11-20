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

test("src: never imports or names lucide (a devDependency for tests and the demo only); it is pinned exactly", () => {
  let n = 0;
  for (const [, s] of SRC) n += (s.match(/lucide/gi) || []).length;
  assert.equal(n, 0, "src mentions lucide");
  const pkg = JSON.parse(readFileSync(ROOT + "package.json", "utf8"));
  assert.match(pkg.devDependencies.lucide, /^\d+\.\d+\.\d+$/, "lucide is pinned to one exact version");
  const lock = JSON.parse(readFileSync(ROOT + "package-lock.json", "utf8"));
  assert.equal(lock.packages["node_modules/lucide"].version, pkg.devDependencies.lucide);
  assert.ok(readFileSync(ROOT + "README.md", "utf8").includes(`| lucide | ${pkg.devDependencies.lucide} | ISC |`), "README devDependency licence row");
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

// The structured scan above reads font-family, --*font* variables and the FONT/MONO constants. These two read what it
// does not: the `font:` shorthand, `fontFamily =` / `.font =` assignments, and any font name left anywhere in src once
// the two allowed lists are cut out.
const KEYWORD = /^(inherit|initial|unset|revert)$/;
const BANNED = ["Arial", "Helvetica", "Roboto", "Inter", "Segoe", "Ubuntu", "Cantarell", "Noto", "Oxygen", "Open Sans",
  "Fira", "Source Sans", "Source Code", "Lato", "Montserrat", "Times", "Georgia", "Verdana", "Tahoma", "Trebuchet",
  "Lucida", "Courier", "Consolas", "Monaco", "Menlo", "SF Mono", "SF Pro", "San Francisco", "DejaVu", "Liberation",
  "JetBrains", "Cascadia", "Comic Sans", "Impact", "PingFang", "Hiragino", "Meiryo", "Apple Color Emoji"];
test("src: font shorthands and font assignments use only the system lists", () => {
  const bad = [];
  let seen = 0;
  for (const [p, raw] of SRC) {
    const text = raw.replace(/\\"/g, '"');
    // CSS `font:` shorthand: a CSS-wide keyword, or a value whose family part (the end) is var(...) or an allowed list.
    for (const m of text.matchAll(/(?<![\w-])font\s*:\s*([^;}\n]+)/g)) {
      const v = m[1].trim(); seen++;
      if (!(KEYWORD.test(v) || /var\([^)]*\)\)?$/.test(v) || v.endsWith(SANS) || v.endsWith(MONO))) bad.push([p, m[0]]);
    }
    // el.style.fontFamily = "…"
    for (const m of text.matchAll(/\bfontFamily\s*=\s*(['"`])(.*?)\1/g)) {
      const v = m[2].trim(); seen++;
      if (!(/^var\(/.test(v) || KEYWORD.test(v) || v === SANS || v === MONO)) bad.push([p, m[0]]);
    }
    // canvas ctx.font = `…px ${FONT}`: the literal part names no family, the interpolations name only FONT / MONO.
    for (const m of text.matchAll(/\.font\s*=\s*`([^`]*)`/g)) {
      seen++;
      const lits = m[1].replace(/\$\{[^}]*\}/g, " ").trim();
      const exprs = [...m[1].matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]);
      const famExpr = exprs.at(-1) || "";
      const idents = famExpr.replace(/(['"]).*?\1/g, "").match(/\b[A-Z][A-Z_]*\b/g) || [];
      if (!/^[\d\s]*px$/.test(lits.replace(/\s+/g, " ").replace(/ px$/, "px")) || !idents.length || idents.some((i) => i !== "FONT" && i !== "MONO") || /['"]/.test(famExpr.replace(/[!=]==\s*(['"]).*?\1/g, "")) || !m[1].trimEnd().endsWith("}")) bad.push([p, m[0]]);
    }
    for (const m of text.matchAll(/\.font\s*=\s*(['"])(.*?)\1/g)) { seen++; bad.push([p, m[0]]); } // a canvas font never written as a fixed string
  }
  assert.deepEqual(bad, [], "font shorthands / assignments outside the system lists");
  // mindmap.css has 4 `font: inherit` and mindmap.js carries the same 4 plus fontFamily and ctx2d.font: fewer is a broken scan.
  assert.ok(seen >= 10, `only ${seen} font shorthands / assignments found`);
});

test("src: no font name outside the two allowed lists, anywhere in src", () => {
  const bad = [];
  for (const [p, raw] of SRC) {
    const text = raw.replace(/\\"/g, '"').split(SANS).join(" ").split(MONO).join(" ");
    for (const name of BANNED) {
      const re = new RegExp(`(?<![\\w-])${name.replace(/ /g, "\\s+")}(?![\\w-])`, "g");
      for (const m of text.matchAll(re)) bad.push([p, m[0], text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, " ")]);
    }
  }
  assert.deepEqual(bad, [], "font names outside the system lists");
  // the cut must have happened, or the scan read nothing: svg.js FONT and MONO, mindmap.css and mindmap.js once each.
  const cuts = SRC.reduce((n, [, raw]) => n + raw.replace(/\\"/g, '"').split(SANS).length - 1 + raw.replace(/\\"/g, '"').split(MONO).length - 1, 0);
  assert.ok(cuts >= 6, `only ${cuts} allowed lists cut out of src`);
});
