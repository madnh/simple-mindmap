import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../src/core.js";
import { layout, overlaps } from "../../src/layout.js";
import { fakeMeasure } from "../../src/svg.js";
import { randomTree } from "../helpers.mjs";

const data = (root) => validate({ root }).data;
const VIEWS = ["both", "right", "outline"];
const big = data(randomTree(500, 42));

for (const view of VIEWS) {
  test(`${view}: 500 random nodes (seed 42), no overlapping boxes, all laid out`, () => {
    const lay = layout(big, { view, measure: fakeMeasure });
    assert.equal(lay.boxes.size, 500);
    assert.equal(overlaps(lay.boxes), 0);
  });
  test(`${view}: sibling order is kept`, () => {
    const lay = layout(big, { view, measure: fakeMeasure });
    (function rec(n, num) {
      const ids = (n.children || []).map((c, i) => c.id || (num ? `${num}.${i + 1}` : String(i + 1)));
      const bySide = new Map();
      for (const id of ids) { const b = lay.boxes.get(id); (bySide.get(b.side) || bySide.set(b.side, []).get(b.side)).push(b.y); }
      for (const ys of bySide.values()) for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `order under ${n.id}`);
      (n.children || []).forEach((c, i) => rec(c, num ? `${num}.${i + 1}` : String(i + 1)));
    })(big.root, "");
  });
}

test("overlaps() detects an overlap (guards the guard)", () => {
  assert.equal(overlaps([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }]), 1);
  assert.equal(overlaps([{ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }]), 0);
});

test("both: root centred at 0,0, two sides balanced by leaves, first child on the right, order kept", () => {
  const lay = layout(big, { view: "both", measure: fakeMeasure });
  const root = lay.boxes.get(big.root.id);
  assert.equal(root.x + root.w / 2, 0);
  assert.equal(root.y + root.h / 2, 0);
  const leaves = (n) => (n.children && n.children.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1);
  const sides = big.root.children.map((c) => lay.boxes.get(c.id).side);
  assert.equal(sides[0], 1);
  const firstLeft = sides.indexOf(-1);
  assert.ok(firstLeft > 0 && sides.slice(firstLeft).every((s) => s === -1), "right side is a prefix");
  const L = big.root.children.map(leaves);
  const right = L.slice(0, firstLeft).reduce((a, b) => a + b, 0), left = L.slice(firstLeft).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(right - left) <= Math.max(...L), `balanced: right ${right}, left ${left}`);
  for (const c of big.root.children) {
    const b = lay.boxes.get(c.id);
    if (b.side > 0) assert.ok(b.x > root.x + root.w); else assert.ok(b.x + b.w < root.x);
  }
});

test("right: every child is right of its parent; outline: rows go down, indented by depth", () => {
  const r = layout(big, { view: "right", measure: fakeMeasure });
  for (const e of r.edges) assert.ok(r.boxes.get(e.to).x > r.boxes.get(e.from).x + r.boxes.get(e.from).w);
  const o = layout(big, { view: "outline", measure: fakeMeasure });
  const ys = o.order.map((b) => b.y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1]);
  for (const e of o.edges) assert.ok(o.boxes.get(e.to).x > o.boxes.get(e.from).x);
});

test("collapsed nodes hide their subtree and carry the hidden count", () => {
  const d = data({ id: "r", title: "R", children: [{ id: "a", title: "A", children: [{ title: "x" }, { title: "y", children: [{ title: "z" }] }] }, { id: "b", title: "B" }] });
  const lay = layout(d, { view: "right", measure: fakeMeasure, collapsed: new Set(["a"]) });
  assert.deepEqual([...lay.boxes.keys()], ["r", "a", "b"]);
  assert.equal(lay.boxes.get("a").hidden, 3);
  assert.equal(lay.boxes.get("a").chip, "+3");
});

test("focus draws a branch as the root; numbers stay global", () => {
  const d = data({ id: "r", title: "R", children: [{ id: "a", title: "A", children: [{ id: "a1", title: "A1" }] }, { id: "b", title: "B" }] });
  const lay = layout(d, { view: "both", measure: fakeMeasure, focus: "a" });
  assert.deepEqual([...lay.boxes.keys()].sort(), ["a", "a1"]);
  assert.equal(lay.rootId, "a");
  assert.equal(lay.boxes.get("a1").num, "1.1");
});

test("long titles are clipped at 48 graphemes on the map, not in the outline", () => {
  const t = "\u{1F469}‍\u{1F469}‍\u{1F467}".repeat(60);
  const d = data({ title: "R", children: [{ id: "x", title: t }] });
  const m = layout(d, { view: "right", measure: fakeMeasure }).boxes.get("x").label;
  assert.equal([...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(m)].length, 48);
  assert.ok(m.endsWith("…"));
  assert.equal(layout(d, { view: "outline", measure: fakeMeasure }).boxes.get("x").label, t);
});

test("badge(node, id) adds width and is called for every drawn node", () => {
  const d = data({ id: "r", title: "R", children: [{ id: "a", title: "A" }] });
  const seen = [];
  const lay = layout(d, { view: "right", measure: fakeMeasure, badge: (n, id) => { seen.push(id); return id === "a" ? { symbol: "*", label: "new" } : null; } });
  const plain = layout(d, { view: "right", measure: fakeMeasure });
  assert.deepEqual(seen.sort(), ["a", "r"]);
  assert.ok(lay.boxes.get("a").w > plain.boxes.get("a").w);
});

test("measure is required", () => {
  assert.throws(() => layout(big, { view: "both" }), TypeError);
});

test("2000-node sample: no overlaps in both / right (time printed)", () => {
  const d = validate(JSON.parse(readFileSync(new URL("../fixtures/v1/large-2000.json", import.meta.url), "utf8"))).data;
  for (const view of ["both", "right"]) {
    const t0 = performance.now();
    const lay = layout(d, { view, measure: fakeMeasure });
    const ms = performance.now() - t0;
    assert.equal(lay.boxes.size, 2000);
    assert.equal(overlaps(lay.boxes), 0);
    console.log(`# layout 2000 ${view}: ${ms.toFixed(1)} ms`);
  }
});
