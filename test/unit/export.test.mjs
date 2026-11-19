import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toOutline, toMermaid, fromOutline, validate } from "../../src/core.js";

const read = (p) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8");
const fx = (name) => JSON.parse(read(`v1/${name}`));

test("toOutline / toMermaid: byte-equal to the golden files", () => {
  for (const name of ["architecture", "text"]) {
    assert.equal(toOutline(fx(`${name}.json`)), read(`golden/${name}.outline.md`), `${name} outline`);
    assert.equal(toMermaid(fx(`${name}.json`)), read(`golden/${name}.mermaid`), `${name} mermaid`);
  }
});

test("fromOutline: byte-equal to the golden JSON", () => {
  const md = read("golden/handwritten.outline.md");
  assert.equal(JSON.stringify(fromOutline(md), null, 2) + "\n", read("golden/handwritten.json"));
  assert.equal(validate(fromOutline(md)).ok, true);
});

test("fromOutline(toOutline(x)) keeps titles, notes and structure", () => {
  const strip = (n) => ({ title: n.title, ...(n.note ? { note: n.note } : {}), ...(n.children ? { children: n.children.map(strip) } : {}) });
  for (const name of ["architecture.json", "text.json", "statuses-tones.json", "minimal.json"]) {
    const src = validate(fx(name)).data;
    const back = fromOutline(toOutline(src));
    assert.deepEqual(strip(back.root), strip(src.root), name);
    assert.equal(back.title, src.title, name);
  }
});

test("fromOutline: several top-level bullets get a root; empty input has no root", () => {
  assert.deepEqual(fromOutline("- a\n- b\n"), { mindmap: 1, root: { title: "Mindmap", children: [{ title: "a" }, { title: "b" }] } });
  assert.equal(fromOutline("# Plan\n\n- a\n- b").root.title, "Plan");
  assert.equal(fromOutline("- a\n- b", { rootTitle: "Top" }).root.title, "Top");
  assert.equal(fromOutline("").root, undefined);
  assert.equal(validate(fromOutline("")).errors[0].code, "missing_root");
  assert.deepEqual(fromOutline("* a\n\t+ b\r\n"), { mindmap: 1, root: { title: "a", children: [{ title: "b" }] } });
});

test("invalid data exports nothing", () => {
  assert.equal(toOutline({ root: {} }), null);
  assert.equal(toMermaid("nope"), null);
});
