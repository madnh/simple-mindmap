// Data model: validation, normalisation and tree helpers. Pure, no DOM.

export const FORMAT = 1;
export const VIEWS = ["both", "right", "outline"];
export const TONES = ["green", "amber", "red", "blue", "purple", "grey"];
export const LINK_TYPES = ["relates", "blocks", "supersedes"];
export const STATUS_KEYS = ["open", "pending", "decided", "parked", "blocked", "superseded"];
export const DEFAULT_LIMITS = Object.freeze({ nodes: 2000, depth: 16, title: 200, label: 60, note: 16384, meta: 4096 });

export const ERROR_CODES = Object.freeze([
  "not_object", "bad_version", "missing_root", "missing_title", "bad_id", "dup_id", "too_many_nodes", "too_deep",
  "bad_status", "bad_tone", "bad_layout", "bad_link", "self_link", "bad_meta", "text_too_long",
  "no_such_node", "move_into_self", "bad_op",
]);

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HAS_LETTER = /[A-Za-z]/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const MAP_KEYS = new Set(["mindmap", "title", "layout", "root", "links"]);
const NODE_KEYS = new Set(["id", "title", "note", "status", "tone", "collapsed", "meta", "children"]);
const LINK_KEYS = new Set(["from", "to", "type", "label"]);
const MAX_ERRORS = 100;

let segmenter = null;
export function graphemes(s) {
  if (!segmenter) segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : false;
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s);
}
export function clip(s, n) { const g = graphemes(s); return g.length > n ? g.slice(0, n - 1).join("") + "\u2026" : s; }
export function oneLine(s) { return s.normalize("NFC").replace(CONTROL, ""); }
const bytes = (s) => new TextEncoder().encode(s).length;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function isValidId(id) { return typeof id === "string" && ID_RE.test(id) && HAS_LETTER.test(id); }

function statusKeys(statuses) {
  if (!statuses) return new Set(STATUS_KEYS);
  return new Set(Array.isArray(statuses) ? statuses : Object.keys(statuses));
}

// validate(json, {limits, statuses}) -> {ok, errors, warnings, data}
export function validate(input, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const statuses = statusKeys(opts.statuses);
  const errors = [], warnings = [];
  const err = (path, code, message, extra) => { if (errors.length < MAX_ERRORS) errors.push({ path, code, message, ...extra }); };
  const warn = (path, code, message) => { if (warnings.length < MAX_ERRORS) warnings.push({ path, code, message }); };
  const fail = () => ({ ok: false, errors, warnings, data: null });

  let json = input;
  if (typeof json === "string") {
    try { json = JSON.parse(json); } catch (e) { err("", "not_object", "Data is not valid JSON"); return fail(); }
  }
  if (!isObj(json)) { err("", "not_object", "Data must be a JSON object"); return fail(); }

  const data = { mindmap: FORMAT };
  for (const k of Object.keys(json)) if (!MAP_KEYS.has(k)) warn(k, "unknown_key", `Unknown key "${k}" ignored`);
  if (json.mindmap !== undefined && json.mindmap !== FORMAT) err("mindmap", "bad_version", `Unsupported format version ${JSON.stringify(json.mindmap)}`);
  if (json.title !== undefined) {
    if (typeof json.title !== "string") err("title", "missing_title", "Map title must be a string");
    else {
      const t = oneLine(json.title);
      if (graphemes(t).length > limits.title) err("title", "text_too_long", `Map title is longer than ${limits.title} characters`, { limit: limits.title });
      data.title = t;
    }
  }
  if (json.layout !== undefined) {
    if (!VIEWS.includes(json.layout)) err("layout", "bad_layout", `Unknown layout ${JSON.stringify(json.layout)}`);
    else data.layout = json.layout;
  }
  if (!("root" in json) || json.root === undefined || json.root === null) { err("root", "missing_root", "Data has no root node"); return fail(); }
  if (!isObj(json.root)) { err("root", "not_object", "Root must be an object"); return fail(); }

  const ids = new Map(); // id -> path
  let count = 0, deepReported = false, manyReported = false;
  const seen = new Set();

  function node(src, path, depth, numPath) {
    if (!isObj(src)) { err(path, "not_object", "Node must be an object"); return null; }
    if (seen.has(src)) { err(path, "not_object", "Node appears twice (cycle)"); return null; }
    seen.add(src);
    count++;
    if (count > limits.nodes) {
      if (!manyReported) { manyReported = true; err(path, "too_many_nodes", `Map has more than ${limits.nodes} nodes`, { limit: limits.nodes }); }
      return null;
    }
    if (depth > limits.depth) {
      if (!deepReported) { deepReported = true; err(path, "too_deep", `Map is deeper than ${limits.depth} levels`, { limit: limits.depth }); }
      return null;
    }
    const out = {};
    const info = {};
    for (const k of Object.keys(src)) if (!NODE_KEYS.has(k)) warn(`${path}.${k}`, "unknown_key", `Unknown key "${k}" ignored`);
    if (typeof src.title === "string") { out.title = oneLine(src.title); info.title = out.title; }
    if (src.id !== undefined) {
      if (!isValidId(src.id)) err(`${path}.id`, "bad_id", `Invalid id ${JSON.stringify(String(src.id)).slice(0, 80)}`, info);
      else if (ids.has(src.id)) err(`${path}.id`, "dup_id", `Id "${src.id}" is used by another node`, { id: src.id, ...info });
      else { ids.set(src.id, path); out.id = src.id; }
    }
    const who = { ...(out.id ? { id: out.id } : {}), ...info };
    if (typeof src.title !== "string" || out.title === "") err(`${path}.title`, "missing_title", "Node has no title", who);
    else if (graphemes(out.title).length > limits.title) err(`${path}.title`, "text_too_long", `Title is longer than ${limits.title} characters`, { ...who, limit: limits.title });
    if (src.note !== undefined) {
      if (typeof src.note !== "string") err(`${path}.note`, "text_too_long", "Note must be a string", who);
      else if (bytes(src.note) > limits.note) err(`${path}.note`, "text_too_long", `Note is larger than ${limits.note} bytes`, { ...who, limit: limits.note });
      else out.note = src.note.normalize("NFC");
    }
    if (src.status !== undefined) {
      if (typeof src.status !== "string" || !statuses.has(src.status)) err(`${path}.status`, "bad_status", `Unknown status ${JSON.stringify(src.status)}`, who);
      else out.status = src.status;
    }
    if (src.tone !== undefined) {
      if (!TONES.includes(src.tone)) err(`${path}.tone`, "bad_tone", `Unknown tone ${JSON.stringify(src.tone)}`, who);
      else if (src.status !== undefined) warn(`${path}.tone`, "tone_ignored", "Tone ignored because the node has a status");
      else out.tone = src.tone;
    }
    if (src.collapsed !== undefined) {
      if (typeof src.collapsed !== "boolean") warn(`${path}.collapsed`, "bad_value", "collapsed must be true or false; ignored");
      else if (src.collapsed) out.collapsed = true;
    }
    if (src.meta !== undefined) {
      let size = Infinity;
      if (isObj(src.meta)) { try { size = bytes(JSON.stringify(src.meta)); } catch { size = Infinity; } }
      if (!isObj(src.meta)) err(`${path}.meta`, "bad_meta", "meta must be an object", who);
      else if (size > limits.meta) err(`${path}.meta`, "bad_meta", `meta is larger than ${limits.meta} bytes`, { ...who, limit: limits.meta });
      else out.meta = JSON.parse(JSON.stringify(src.meta));
    }
    if (src.children !== undefined) {
      if (!Array.isArray(src.children)) err(`${path}.children`, "not_object", "children must be an array", who);
      else {
        out.children = [];
        src.children.forEach((c, i) => {
          const n = node(c, `${path}.children[${i}]`, depth + 1, numPath ? `${numPath}.${i + 1}` : String(i + 1));
          if (n) out.children.push(n);
        });
        if (!out.children.length && !src.children.length) delete out.children;
      }
    }
    return out;
  }

  data.root = node(json.root, "root", 1, "");

  if (json.links !== undefined) {
    if (!Array.isArray(json.links)) err("links", "not_object", "links must be an array");
    else {
      const all = data.root ? nodeIds(data) : new Set();
      data.links = [];
      json.links.forEach((l, i) => {
        const p = `links[${i}]`;
        if (!isObj(l)) { err(p, "not_object", "Link must be an object"); return; }
        for (const k of Object.keys(l)) if (!LINK_KEYS.has(k)) warn(`${p}.${k}`, "unknown_key", `Unknown key "${k}" ignored`);
        const type = l.type === undefined ? "relates" : l.type;
        let bad = false;
        if (!LINK_TYPES.includes(type)) { err(`${p}.type`, "bad_link", `Unknown link type ${JSON.stringify(l.type)}`); bad = true; }
        for (const end of ["from", "to"]) {
          if (typeof l[end] !== "string" || !all.has(l[end])) { err(`${p}.${end}`, "bad_link", `Link ${end} ${JSON.stringify(l[end])} is not a node`, { id: typeof l[end] === "string" ? l[end] : undefined }); bad = true; }
        }
        if (!bad && l.from === l.to) { err(p, "self_link", `Node "${l.from}" links to itself`, { id: l.from }); bad = true; }
        const out = { from: l.from, to: l.to, type };
        if (l.label !== undefined) {
          if (typeof l.label !== "string") { err(`${p}.label`, "text_too_long", "Link label must be a string"); bad = true; }
          else {
            out.label = oneLine(l.label);
            if (graphemes(out.label).length > limits.label) { err(`${p}.label`, "text_too_long", `Link label is longer than ${limits.label} characters`, { limit: limits.label }); bad = true; }
          }
        }
        if (!bad) data.links.push(out);
      });
    }
  }
  for (const e of errors) for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return errors.length ? fail() : { ok: true, errors, warnings, data };
}

// ---- tree helpers (operate on normalised data) ----

// Walks the tree pre-order: fn(node, {id, path, num, depth, parent, index})
export function walk(data, fn) {
  if (!data || !data.root) return;
  (function rec(n, num, depth, parent, index) {
    const id = n.id || (num || "0");
    if (fn(n, { id, num, depth, parent, index }) === false) return;
    (n.children || []).forEach((c, i) => rec(c, num ? `${num}.${i + 1}` : String(i + 1), depth + 1, n, i));
  })(data.root, "", 0, null, 0);
}

export function nodeIds(data) { const s = new Set(); walk(data, (n, x) => { s.add(x.id); if (!n.id) s.add(x.id); }); return s; }

// Index: id -> {node, id, num, depth, parent (node), parentId, index}
export function indexTree(data) {
  const map = new Map();
  const idOf = new Map();
  walk(data, (n, x) => {
    idOf.set(n, x.id);
    map.set(x.id, { node: n, id: x.id, num: x.num, depth: x.depth, parent: x.parent, parentId: x.parent ? idOf.get(x.parent) : null, index: x.index });
  });
  return map;
}

export function pathOf(json, id) {
  const data = json && json.root ? json : null;
  if (!data) return null;
  let out = null;
  walk(data, (n, x) => { if (x.id === id) { out = x.num; return false; } return out === null; });
  return out;
}

export function countNodes(n) { let c = 1; for (const k of n.children || []) c += countNodes(k); return c; }

export function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
