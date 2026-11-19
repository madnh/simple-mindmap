import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toSVG, fakeMeasure, THEME, FONT, escapeXml } from "../../src/svg.js";

const read = (p) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8");
const fx = (name) => JSON.parse(read(`v1/${name}`));
const svg = (name, o = {}) => toSVG(fx(name), { measure: fakeMeasure, ...o });

// Checks that every opened tag is closed in order (enough to catch broken escaping).
function balanced(s) {
  const stack = [];
  for (const m of s.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]); else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

test("byte-equal to the golden file (fake measure, right layout)", () => {
  assert.equal(svg("architecture.json", { view: "right" }), read("golden/architecture.right.svg"));
});

test("all three views produce a well-formed, deterministic SVG", () => {
  for (const view of ["both", "right", "outline"]) {
    const a = svg("architecture.json", { view }), b = svg("architecture.json", { view });
    assert.equal(a, b);
    assert.ok(a.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), view);
    assert.ok(balanced(a), view);
  }
});

test("titles become escaped text: <img onerror> is never markup", () => {
  const s = svg("text.json");
  assert.ok(!/<img/i.test(s));
  assert.ok(s.includes("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot; &#39;single&#39;"));
  assert.ok(!s.includes("<b>"), "link label escaped");
  assert.ok(balanced(s));
  assert.equal(escapeXml("a\u0000b\u0007c"), "abc");
});

test("concrete colours, system fonts only, no CSS variables, no note content", () => {
  const s = svg("architecture.json");
  assert.ok(!s.includes("var("));
  assert.ok(s.includes(`font-family="${escapeXml(FONT)}"`));
  assert.ok(!/@import|url\(http|<link|<script/i.test(s));
  assert.ok(!s.includes("Markdown"), "note is not drawn");
  assert.ok(s.includes(THEME["root-bg"]));
  const dark = svg("architecture.json", { theme: { "root-bg": "#123456" } });
  assert.ok(dark.includes("#123456") && !dark.includes(THEME["root-bg"]));
});

test("links: blocks shown by default with an arrow; relates only with links: all", () => {
  const def = svg("architecture.json");
  assert.ok(def.includes('marker-end="url(#mm-arrow-blocks)"'));
  assert.ok(!def.includes("shared profile"));
  assert.ok(svg("architecture.json", { links: "all" }).includes("shared profile"));
  assert.ok(svg("architecture.json", { selected: "plugin" }).includes("shared profile"), "links of the selected node");
});

test("collapsed branches and badges are drawn", () => {
  const s = svg("architecture.json", { collapsed: ["plugin"], badge: (n, id) => (id === "pane" ? { symbol: "NEW", label: "changed" } : null) });
  assert.ok(s.includes(">+2<"));
  assert.ok(s.includes(">NEW<"));
  assert.ok(!s.includes("Permission prompt"));
});

test("invalid data gives null", () => {
  assert.equal(toSVG({ root: {} }, { measure: fakeMeasure }), null);
});

test("filter fades every node whose status is not listed", () => {
  const s = svg("statuses-tones.json", { filter: ["open", "blocked"] });
  assert.equal((s.match(/<g transform="[^"]*" data-id="[^"]*" opacity="0.35"/g) || []).length, 13 - 2);
  assert.ok(!svg("statuses-tones.json").includes('opacity="0.35"'));
});
