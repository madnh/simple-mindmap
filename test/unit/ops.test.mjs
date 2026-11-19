import test from "node:test";
import assert from "node:assert/strict";
import { applyOps, validate } from "../../src/core.js";

const tree = () => ({
  mindmap: 1, title: "Ops",
  root: { id: "r", title: "Root", children: [
    { id: "a", title: "A", children: [{ id: "a1", title: "A1" }, { id: "a2", title: "A2" }] },
    { id: "b", title: "B", status: "open" },
    { id: "c", title: "C", tone: "red" },
  ] },
  links: [{ from: "a1", to: "b", type: "blocks" }],
});
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.data; };
const kids = (n) => (n.children || []).map((c) => c.id || c.title);

test("add: append, first, after, with a subtree", () => {
  let d = ok(applyOps(tree(), [{ op: "add", parent: "r", node: { id: "d", title: "D", children: [{ id: "d1", title: "D1" }] } }]));
  assert.deepEqual(kids(d.root), ["a", "b", "c", "d"]);
  d = ok(applyOps(tree(), [{ op: "add", parent: "r", first: true, node: { id: "z", title: "Z" } }]));
  assert.deepEqual(kids(d.root), ["z", "a", "b", "c"]);
  d = ok(applyOps(tree(), [{ op: "add", parent: "a", after: "a1", node: { id: "m", title: "M" } }]));
  assert.deepEqual(kids(d.root.children[0]), ["a1", "m", "a2"]);
  assert.equal(applyOps(tree(), [{ op: "add", parent: "a", after: "b", node: { title: "x" } }]).errors[0].code, "no_such_node");
});

test("edit / status / meta", () => {
  let d = ok(applyOps(tree(), [{ op: "edit", id: "a", title: "A!", note: "n" }, { op: "edit", id: "c", tone: null }]));
  assert.equal(d.root.children[0].title, "A!");
  assert.equal(d.root.children[0].note, "n");
  assert.equal(d.root.children[2].tone, undefined);
  d = ok(applyOps(tree(), [{ op: "status", id: "c", to: "decided" }, { op: "status", id: "b", to: null }]));
  assert.equal(d.root.children[2].status, "decided");
  assert.equal(d.root.children[2].tone, undefined, "status replaces tone");
  assert.equal(d.root.children[1].status, undefined);
  d = ok(applyOps(tree(), [{ op: "meta", id: "b", meta: { by: "x", at: 1 } }, { op: "meta", id: "b", meta: { at: 2, gone: null } }]));
  assert.deepEqual(d.root.children[1].meta, { by: "x", at: 2 });
  assert.equal(applyOps(tree(), [{ op: "status", id: "b", to: "nope" }]).errors[0].code, "bad_status");
  assert.equal(applyOps(tree(), [{ op: "meta", id: "b", meta: "x" }]).errors[0].code, "bad_meta");
  assert.equal(applyOps(tree(), [{ op: "edit", id: "b", title: "" }]).errors[0].code, "missing_title");
});

test("move: reorder, reparent, never into itself or a descendant", () => {
  let d = ok(applyOps(tree(), [{ op: "move", id: "c", parent: "r", first: true }]));
  assert.deepEqual(kids(d.root), ["c", "a", "b"]);
  d = ok(applyOps(tree(), [{ op: "move", id: "b", parent: "a", after: "a1" }]));
  assert.deepEqual(kids(d.root.children[0]), ["a1", "b", "a2"]);
  assert.equal(applyOps(tree(), [{ op: "move", id: "a", parent: "a1" }]).errors[0].code, "move_into_self");
  assert.equal(applyOps(tree(), [{ op: "move", id: "a", parent: "a" }]).errors[0].code, "move_into_self");
  assert.equal(applyOps(tree(), [{ op: "move", id: "r", parent: "a" }]).errors[0].code, "bad_op");
});

test("remove: leaf, recursive, links to removed nodes go too", () => {
  let d = ok(applyOps(tree(), [{ op: "remove", id: "c" }]));
  assert.deepEqual(kids(d.root), ["a", "b"]);
  assert.equal(applyOps(tree(), [{ op: "remove", id: "a" }]).errors[0].code, "bad_op");
  d = ok(applyOps(tree(), [{ op: "remove", id: "a", recursive: true }]));
  assert.deepEqual(kids(d.root), ["b", "c"]);
  assert.equal(d.links, undefined);
  assert.equal(applyOps(tree(), [{ op: "remove", id: "r", recursive: true }]).errors[0].code, "bad_op");
});

test("link / unlink", () => {
  let d = ok(applyOps(tree(), [{ op: "link", from: "a", to: "c", type: "relates", label: "see" }, { op: "link", from: "a", to: "c", type: "relates", label: "again" }]));
  assert.deepEqual(d.links, [{ from: "a1", to: "b", type: "blocks" }, { from: "a", to: "c", type: "relates", label: "again" }]);
  d = ok(applyOps(tree(), [{ op: "unlink", from: "a1", to: "b", type: "blocks" }]));
  assert.equal(d.links, undefined);
  assert.equal(applyOps(tree(), [{ op: "link", from: "a", to: "a" }]).errors[0].code, "self_link");
  assert.equal(applyOps(tree(), [{ op: "link", from: "a", to: "nope" }]).errors[0].code, "no_such_node");
  assert.equal(applyOps(tree(), [{ op: "link", from: "a", to: "b", type: "x" }]).errors[0].code, "bad_link");
});

test("view-only ops change no data and are returned", () => {
  const r = applyOps(tree(), [{ op: "collapse", id: "a" }, { op: "select", id: "b" }, { op: "focus", id: null }, { op: "expand", id: "a" }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, validate(tree()).data);
  assert.deepEqual(r.view, [{ op: "collapse", id: "a" }, { op: "select", id: "b" }, { op: "focus", id: null }, { op: "expand", id: "a" }]);
  assert.equal(applyOps(tree(), [{ op: "select", id: "zz" }]).errors[0].code, "no_such_node");
});

test("a batch failing at op 3 changes nothing and names the index", () => {
  const input = tree();
  const snap = JSON.stringify(input);
  const r = applyOps(input, [
    { op: "edit", id: "a", title: "changed" },
    { op: "add", parent: "r", node: { id: "new", title: "New" } },
    { op: "move", id: "a", parent: "a2" },
    { op: "status", id: "b", to: "decided" },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.index, 2);
  assert.equal(r.errors[0].path, "ops[2]");
  assert.equal(r.errors[0].code, "move_into_self");
  assert.equal(r.data, undefined);
  assert.equal(JSON.stringify(input), snap, "input untouched");
});

test("the whole batch is checked after the last op (duplicate id)", () => {
  const r = applyOps(tree(), [{ op: "add", parent: "r", node: { id: "a1", title: "dup" } }]);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "dup_id");
});

test("invalid input data and non-array ops are refused", () => {
  assert.equal(applyOps({ root: {} }, []).ok, false);
  assert.equal(applyOps(tree(), "nope").errors[0].code, "bad_op");
  assert.equal(applyOps(tree(), [null]).errors[0].code, "bad_op");
});

test("nodes without id are addressed by path; sequential semantics", () => {
  const d = ok(applyOps({ root: { title: "R", children: [{ title: "x" }, { title: "y" }] } }, [
    { op: "add", parent: "0", first: true, node: { title: "w" } },
    { op: "edit", id: "2", title: "x!" },
  ]));
  assert.deepEqual(d.root.children.map((c) => c.title), ["w", "x!", "y"]);
});

test("links name nodes by explicit id: a position id is bad_link (link op)", () => {
  const anon = { root: { id: "r", title: "R", children: [{ title: "x" }, { id: "y", title: "y" }] } };
  const r = applyOps(anon, [{ op: "link", from: "1", to: "y" }]);
  assert.equal(r.ok, false);
  assert.deepEqual([r.index, r.errors[0].code, r.errors[0].path], [0, "bad_link", "ops[0].from"]);
  ok(applyOps(anon, [{ op: "link", from: "y", to: "r" }]));
});

test("applyOps never throws: values JSON cannot hold are bad_op / bad_meta at ops[i]", () => {
  const cyc = { title: "c" }; cyc.children = [cyc];
  let r = applyOps(tree(), [{ op: "edit", id: "a", title: "ok" }, { op: "add", parent: "r", node: cyc }]);
  assert.deepEqual([r.ok, r.index, r.errors[0].code, r.errors[0].path], [false, 1, "bad_op", "ops[1].node"]);
  r = applyOps(tree(), [{ op: "meta", id: "b", meta: { x: 1n } }]);
  assert.deepEqual([r.ok, r.index, r.errors[0].code, r.errors[0].path], [false, 0, "bad_meta", "ops[0].meta"]);
  const evil = { op: "edit", id: "a" };
  Object.defineProperty(evil, "title", { enumerable: true, get() { throw new Error("boom"); } });
  r = applyOps(tree(), [evil]);
  assert.deepEqual([r.ok, r.index, r.errors[0].code, r.errors[0].path], [false, 0, "bad_op", "ops[0]"]);
});

test("move: 'after' is read against the tree as it was before the move", () => {
  const anon = { root: { title: "R", children: [{ title: "a" }, { title: "b" }, { title: "c" }] } };
  const d = ok(applyOps(anon, [{ op: "move", id: "1", parent: "0", after: "3" }]));
  assert.deepEqual(kids(d.root), ["b", "c", "a"]);
  assert.equal(applyOps(anon, [{ op: "move", id: "1", parent: "0", after: "1" }]).errors[0].code, "move_into_self");
});

test("per-op field checks name the op: status.to, edit title / tone / note, link label", () => {
  const one = (op) => { const r = applyOps(tree(), [{ op: "edit", id: "a", title: "fine" }, op]); return [r.ok, r.index, r.errors[0].code, r.errors[0].path]; };
  assert.deepEqual(one({ op: "status", id: "a", to: "zzz" }), [false, 1, "bad_status", "ops[1].to"]);
  assert.deepEqual(one({ op: "edit", id: "a", title: "" }), [false, 1, "missing_title", "ops[1].title"]);
  assert.deepEqual(one({ op: "edit", id: "a", title: "x".repeat(201) }), [false, 1, "text_too_long", "ops[1].title"]);
  assert.deepEqual(one({ op: "edit", id: "c", tone: "pink" }), [false, 1, "bad_tone", "ops[1].tone"]);
  assert.deepEqual(one({ op: "edit", id: "c", note: 5 }), [false, 1, "text_too_long", "ops[1].note"]);
  assert.deepEqual(one({ op: "link", from: "a", to: "b", label: "l".repeat(61) }), [false, 1, "text_too_long", "ops[1].label"]);
  const custom = applyOps(tree(), [{ op: "status", id: "a", to: "mine" }], { statuses: ["open", "mine"] });
  assert.equal(custom.ok, true, "custom statuses are honoured by the per-op check");
  ok(applyOps(tree(), [{ op: "edit", id: "a", title: "x".repeat(200) }]));
});
