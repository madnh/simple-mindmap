// Operations on mindmap data (section 4.1b). Pure: never mutates its input.
import { validate, indexTree, clone, LINK_TYPES, TONES, DEFAULT_LIMITS, statusKeys, oneLine, graphemes, bytes } from "./model.js";

export const DATA_OPS = ["add", "edit", "status", "move", "remove", "link", "unlink", "meta"];
export const VIEW_OPS = ["collapse", "expand", "select", "focus"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

class OpError extends Error { constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; } }
const fail = (code, message, extra) => { throw new OpError(code, message, extra); };

function need(idx, id, field = "id") {
  if (typeof id !== "string" || !idx.has(id)) fail("no_such_node", `No node with id ${JSON.stringify(id)}`, { field, id: typeof id === "string" ? id : undefined });
  return idx.get(id);
}

// Copies a payload; a value JSON cannot hold (BigInt, cycle, throwing getter) is an op error, not a throw.
function copy(v, code, what, field) {
  try { return clone(v); } catch { return fail(code, `${what} is not plain JSON data`, { field }); }
}

// Per-op checks of single fields, so the error names the op (the final validate stays as a backstop).
function checkTitle(v, rules, field = "title") {
  if (typeof v !== "string" || oneLine(v) === "") fail("missing_title", "Title must be a non-empty string", { field });
  if (graphemes(oneLine(v)).length > rules.limits.title) fail("text_too_long", `Title is longer than ${rules.limits.title} characters`, { field, limit: rules.limits.title });
}

function insert(parent, node, op, idx, field) {
  const list = parent.children || (parent.children = []);
  if (op.first) list.unshift(node);
  else if (op.after !== undefined && op.after !== null) {
    const sib = isObj(op.after) ? op.after : need(idx, op.after, "after");
    const at = list.indexOf(sib.node);
    if (at < 0) fail("no_such_node", `"${sib.id}" is not a child of the target parent`, { field: "after", id: sib.id });
    list.splice(at + 1, 0, node);
  } else list.push(node);
}

function detach(entry) {
  const list = entry.parent.children;
  list.splice(list.indexOf(entry.node), 1);
  if (!list.length) delete entry.parent.children;
}

function subtreeIds(entry, idx) {
  const out = new Set();
  for (const [id, e] of idx) {
    let p = e;
    while (p) { if (p.node === entry.node) { out.add(id); break; } p = p.parentId ? idx.get(p.parentId) : null; }
  }
  return out;
}

function applyOne(data, op, cache, rules) {
  if (!isObj(op)) fail("bad_op", "Operation must be an object");
  if (!cache.idx) cache.idx = indexTree(data);
  const idx = cache.idx;
  if (DATA_OPS.includes(op.op)) cache.idx = null; // data ops change the tree; view ops reuse the index
  switch (op.op) {
    case "add": {
      const parent = need(idx, op.parent, "parent");
      if (!isObj(op.node)) fail("bad_op", "add needs a node object");
      insert(parent.node, copy(op.node, "bad_op", "node", "node"), op, idx, "parent");
      return null;
    }
    case "edit": {
      const e = need(idx, op.id);
      if ("title" in op) checkTitle(op.title, rules);
      if ("tone" in op && op.tone !== null && !TONES.includes(op.tone)) fail("bad_tone", `Unknown tone ${JSON.stringify(op.tone)}`, { field: "tone", id: op.id });
      if ("note" in op && op.note !== null) {
        if (typeof op.note !== "string") fail("text_too_long", "Note must be a string", { field: "note", id: op.id });
        if (bytes(op.note) > rules.limits.note) fail("text_too_long", `Note is larger than ${rules.limits.note} bytes`, { field: "note", id: op.id, limit: rules.limits.note });
      }
      for (const k of ["title", "note", "tone"]) {
        if (!(k in op)) continue;
        if (op[k] === null && k !== "title") delete e.node[k]; else e.node[k] = op[k];
      }
      if (op.tone !== undefined && op.tone !== null && e.node.status !== undefined) delete e.node.tone;
      return null;
    }
    case "status": {
      const e = need(idx, op.id);
      if (!("to" in op)) fail("bad_op", "status needs a 'to' value");
      if (op.to !== null && (typeof op.to !== "string" || !rules.statuses.has(op.to))) fail("bad_status", `Unknown status ${JSON.stringify(op.to)}`, { field: "to", id: op.id });
      if (op.to === null) delete e.node.status; else { e.node.status = op.to; delete e.node.tone; }
      return null;
    }
    case "move": {
      const e = need(idx, op.id);
      const target = need(idx, op.parent, "parent");
      if (!e.parent) fail("bad_op", "The root cannot be moved");
      if (subtreeIds(e, idx).has(target.id)) fail("move_into_self", `Cannot move "${op.id}" into itself or its descendants`, { id: op.id });
      if (op.after === op.id) fail("move_into_self", "A node cannot be placed after itself", { id: op.id });
      // "after" is resolved against the tree as it was when the op started (path ids shift on detach).
      const sib = op.after !== undefined && op.after !== null && !op.first ? need(idx, op.after, "after") : null;
      if (sib && sib.node === e.node) fail("move_into_self", "A node cannot be placed after itself", { id: op.id });
      detach(e);
      insert(target.node, e.node, sib ? { after: sib } : op, null, "parent");
      return null;
    }
    case "remove": {
      const e = need(idx, op.id);
      if (!e.parent) fail("bad_op", "The root cannot be removed");
      if (e.node.children && e.node.children.length && !op.recursive) fail("bad_op", `"${op.id}" has children; pass recursive: true`, { id: op.id });
      const gone = subtreeIds(e, idx);
      detach(e);
      if (data.links) {
        data.links = data.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
        if (!data.links.length) delete data.links;
      }
      return null;
    }
    case "link": {
      for (const end of ["from", "to"]) {
        if (need(idx, op[end], end).node.id !== op[end]) fail("bad_link", `Link ${end} "${op[end]}" is a position, not a node id; give the node an id`, { field: end, id: op[end] });
      }
      if (op.label !== undefined && op.label !== null) {
        if (typeof op.label !== "string") fail("text_too_long", "Link label must be a string", { field: "label" });
        if (graphemes(oneLine(op.label)).length > rules.limits.label) fail("text_too_long", `Link label is longer than ${rules.limits.label} characters`, { field: "label", limit: rules.limits.label });
      }
      const type = op.type === undefined ? "relates" : op.type;
      if (!LINK_TYPES.includes(type)) fail("bad_link", `Unknown link type ${JSON.stringify(op.type)}`);
      const links = data.links || (data.links = []);
      const old = links.find((l) => l.from === op.from && l.to === op.to && l.type === type);
      const l = old || { from: op.from, to: op.to, type };
      if (op.label !== undefined) { if (op.label === null) delete l.label; else l.label = op.label; }
      if (!old) links.push(l);
      return null;
    }
    case "unlink": {
      if (!data.links) return null;
      data.links = data.links.filter((l) => !(l.from === op.from && l.to === op.to && (op.type === undefined || l.type === op.type)));
      if (!data.links.length) delete data.links;
      return null;
    }
    case "meta": {
      const e = need(idx, op.id);
      if (!isObj(op.meta)) fail("bad_meta", "meta must be an object", { id: op.id });
      const m = { ...(e.node.meta || {}) };
      for (const [k, v] of Object.entries(op.meta)) { if (v === null) delete m[k]; else m[k] = copy(v, "bad_meta", `meta.${k}`, "meta"); }
      if (Object.keys(m).length) e.node.meta = m; else delete e.node.meta;
      return null;
    }
    case "collapse": case "expand": case "select":
      need(idx, op.id);
      return { op: op.op, id: op.id };
    case "focus":
      if (op.id !== null && op.id !== undefined) need(idx, op.id);
      return { op: "focus", id: op.id ?? null };
    default:
      fail("bad_op", `Unknown operation ${JSON.stringify(op.op)}`);
  }
}

// applyOps(json, ops, {limits, statuses}) -> {ok, data, view, warnings} | {ok: false, errors, index}
// The whole batch is checked on a copy; nothing is returned half-applied.
export function applyOps(json, ops, opts = {}) {
  const before = validate(json, opts);
  if (!before.ok) return { ok: false, errors: before.errors, index: null };
  if (!Array.isArray(ops)) return { ok: false, errors: [{ path: "ops", code: "bad_op", message: "ops must be an array" }], index: null };
  const data = clone(before.data);
  const view = [];
  const cache = { idx: null };
  const rules = { limits: { ...DEFAULT_LIMITS, ...(opts.limits || {}) }, statuses: statusKeys(opts.statuses) };
  for (let i = 0; i < ops.length; i++) {
    try {
      const v = applyOne(data, ops[i], cache, rules);
      if (v) view.push(v);
    } catch (e) {
      // Never throw to the host: anything unexpected becomes bad_op at this op.
      if (!(e instanceof OpError)) return { ok: false, index: i, errors: [{ path: `ops[${i}]`, code: "bad_op", message: `Operation failed: ${e && e.message ? e.message : String(e)}` }] };
      const extra = { ...(e.extra || {}) };
      const field = extra.field; delete extra.field;
      if (extra.id === undefined) delete extra.id;
      return { ok: false, index: i, errors: [{ path: `ops[${i}]${field ? "." + field : ""}`, code: e.code, message: e.message, ...extra }] };
    }
  }
  const after = validate(data, opts);
  if (!after.ok) return { ok: false, index: null, errors: after.errors };
  return { ok: true, data: after.data, view, warnings: after.warnings };
}
