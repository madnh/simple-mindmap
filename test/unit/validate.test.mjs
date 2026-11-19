import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { validate, applyOps, ERROR_CODES, pathOf, DEFAULT_LIMITS } from "../../src/core.js";

const fx = (name) => JSON.parse(readFileSync(new URL(`../fixtures/v1/${name}`, import.meta.url), "utf8"));
const codes = (r) => r.errors.map((e) => e.code);
const base = () => ({ mindmap: 1, title: "T", root: { id: "r", title: "Root", children: [{ id: "a", title: "A" }, { id: "b", title: "B" }] } });
const withRoot = (patch) => { const d = base(); Object.assign(d.root.children[0], patch); return d; };

// One case per fixed error code (contract 1.x). The apply-only codes go through applyOps.
const CASES = {
  not_object: [() => validate("{not json"), () => validate([1, 2]), () => validate(null)],
  bad_version: [() => validate({ ...base(), mindmap: 2 })],
  missing_root: [() => validate({ mindmap: 1 })],
  missing_title: [() => validate({ root: { id: "r" } }), () => validate(withRoot({ title: "" })), () => validate(withRoot({ title: "\u0007" }))],
  bad_id: [() => validate(withRoot({ id: "has space" })), () => validate(withRoot({ id: "123" })), () => validate(withRoot({ id: "x".repeat(65) }))],
  dup_id: [() => validate(withRoot({ id: "b" }))],
  too_many_nodes: [() => validate({ root: { title: "r", children: Array.from({ length: 2000 }, (_, i) => ({ title: `n${i}` })) } })],
  too_deep: [() => { const r = { title: "1" }; let c = r; for (let i = 2; i <= 17; i++) { c.children = [{ title: String(i) }]; c = c.children[0]; } return validate({ root: r }); }],
  bad_status: [() => validate(withRoot({ status: "done" }))],
  bad_tone: [() => validate(withRoot({ tone: "pink" }))],
  bad_layout: [() => validate({ ...base(), layout: "radial" })],
  bad_link: [() => validate({ ...base(), links: [{ from: "a", to: "zz" }] }), () => validate({ ...base(), links: [{ from: "a", to: "b", type: "likes" }] })],
  self_link: [() => validate({ ...base(), links: [{ from: "a", to: "a" }] })],
  bad_meta: [() => validate(withRoot({ meta: [1] })), () => validate(withRoot({ meta: { x: "y".repeat(4096) } }))],
  text_too_long: [() => validate(withRoot({ title: "x".repeat(201) })), () => validate(withRoot({ note: "x".repeat(16385) })), () => validate({ ...base(), links: [{ from: "a", to: "b", label: "l".repeat(61) }] })],
  no_such_node: [() => applyOps(base(), [{ op: "edit", id: "nope", title: "x" }])],
  move_into_self: [() => applyOps({ root: { id: "r", title: "R", children: [{ id: "a", title: "A", children: [{ id: "c", title: "C" }] }] } }, [{ op: "move", id: "a", parent: "c" }])],
  bad_op: [() => applyOps(base(), [{ op: "rename", id: "a" }])],
};

test("every fixed error code has a case, and nothing else is a code", () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...ERROR_CODES].sort());
});

for (const [code, makers] of Object.entries(CASES)) {
  test(`error code ${code}`, () => {
    makers.forEach((make, i) => {
      const r = make();
      assert.equal(r.ok, false, `case ${i} should fail`);
      assert.ok(codes(r).includes(code), `case ${i}: expected ${code}, got ${codes(r)}`);
      for (const e of r.errors) { assert.equal(typeof e.path, "string"); assert.equal(typeof e.message, "string"); }
    });
  });
}

test("errors carry path, id and title of the node", () => {
  const r = validate(withRoot({ id: "b" }));
  const e = r.errors.find((x) => x.code === "dup_id");
  assert.equal(e.path, "root.children[1].id", "the second holder of an id is the duplicate");
  assert.equal(e.id, "b");
  assert.equal(e.title, "B");
  const t = validate(withRoot({ title: "x".repeat(201) })).errors[0];
  assert.equal(t.limit, 200);
});

test("valid data: normalised copy, input untouched", () => {
  const input = { root: { title: "Café\u0007", note: "line\n\tindent\u0007", children: [{ title: "x", status: "open", tone: "red" }] }, links: [] };
  const snapshot = JSON.stringify(input);
  const r = validate(input);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(r.data.mindmap, 1);
  assert.equal(r.data.root.title, "Café");
  assert.equal(r.data.root.note, "line\n\tindent\u0007", "note is kept verbatim (only NFC)");
  assert.equal(r.data.root.children[0].tone, undefined, "tone dropped when status present");
  assert.deepEqual(r.warnings.map((w) => w.code), ["tone_ignored"]);
});

test("warnings: unknown keys do not block", () => {
  const r = validate({ root: { title: "r", colour: "x" }, extra: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.code).sort(), ["unknown_key", "unknown_key"]);
  assert.equal(r.data.root.colour, undefined);
});

test("limits can be tightened; statuses can be replaced", () => {
  assert.equal(validate(base(), { limits: { nodes: 2 } }).errors[0].code, "too_many_nodes");
  assert.equal(validate(withRoot({ status: "done" }), { statuses: ["done"] }).ok, true);
  assert.equal(validate(withRoot({ status: "open" }), { statuses: { done: {} } }).errors[0].code, "bad_status");
  assert.equal(DEFAULT_LIMITS.nodes, 2000);
});

test("limits are inclusive: exactly at every limit is valid", () => {
  const r = validate(fx("limits.json"));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("1.0 sample data set: every file is valid (must stay valid in every 1.x)", () => {
  const files = readdirSync(new URL("../fixtures/v1/", import.meta.url)).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 6, `found ${files.length} files`);
  for (const f of files) assert.equal(validate(fx(f)).ok, true, f);
});

test("pathOf gives the position number", () => {
  const d = fx("architecture.json");
  assert.equal(pathOf(d, "pane-sound"), "1.2");
  assert.equal(pathOf(d, "root"), "");
  assert.equal(pathOf(d, "2.1"), "2.1", "nodes without id are addressed by their path");
  assert.equal(pathOf(d, "missing"), null);
});

test("a JSON string is accepted", () => {
  assert.equal(validate(JSON.stringify(base())).ok, true);
});

test("links must name explicit ids: a position id is bad_link", () => {
  const d = { root: { title: "R", children: [{ title: "x" }, { title: "y" }, { title: "z" }] }, links: [{ from: "2", to: "3", type: "blocks" }] };
  const r = validate(d);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => [e.path, e.code]), [["links[0].from", "bad_link"], ["links[0].to", "bad_link"]]);
  d.root.children[1].id = "y"; d.root.children[2].id = "z"; d.links = [{ from: "y", to: "z" }];
  assert.equal(validate(d).ok, true);
});
