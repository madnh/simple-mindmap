// Scene building and static SVG export. Pure: runs in node with any measure function.
// The interactive component draws the same scene into the DOM (colours as CSS variables);
// toSVG serialises it with concrete theme colours so the file opens anywhere.
import { validate, indexTree, graphemes } from "./model.js";
import { layout, GEOM } from "./layout.js";

export const FONT = '-apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
export const FONT_SIZE = { node: 13, root: 15, num: 11, small: 11 };

export const THEME = Object.freeze({
  "bg": "#ffffff", "text": "#1f2328", "muted": "#6e7781", "node-bg": "#ffffff", "node-border": "#d0d7de",
  "root-bg": "#24292f", "root-text": "#ffffff", "select": "#0969da", "hit": "#fff1a8", "hit-current": "#ffd33d",
  "chip-bg": "#eaeef2",
  "green": "#1a7f37", "amber": "#bf8700", "red": "#cf222e", "blue": "#0969da", "purple": "#8250df", "grey": "#6e7781",
  "link-blocks": "#cf222e", "link-supersedes": "#6e7781", "link-relates": "#8c959f",
  "edge-0": "#4c8bf5", "edge-1": "#e8710a", "edge-2": "#1e8e3e", "edge-3": "#a142f4",
  "edge-4": "#d93025", "edge-5": "#12a4af", "edge-6": "#c26401", "edge-7": "#5f6368",
});
export const DARK_THEME = Object.freeze({
  ...THEME,
  "bg": "#0d1117", "text": "#e6edf3", "muted": "#8b949e", "node-bg": "#161b22", "node-border": "#30363d",
  "root-bg": "#e6edf3", "root-text": "#0d1117", "select": "#58a6ff", "hit": "#5a4a00", "hit-current": "#9e7700",
  "chip-bg": "#30363d", "green": "#3fb950", "amber": "#d29922", "red": "#f85149", "blue": "#58a6ff",
  "purple": "#bc8cff", "grey": "#8b949e", "link-blocks": "#f85149", "link-supersedes": "#8b949e", "link-relates": "#6e7681",
});
export const TOKENS = Object.keys(THEME);

export const DEFAULT_STATUSES = Object.freeze({
  open: { label: "Open", shape: "open", color: "grey" },
  pending: { label: "Pending", shape: "pending", color: "amber" },
  decided: { label: "Decided", shape: "decided", color: "green" },
  parked: { label: "Parked", shape: "parked", color: "grey" },
  blocked: { label: "Blocked", shape: "blocked", color: "red" },
  superseded: { label: "Superseded", shape: "superseded", color: "grey", strike: true },
});

// ---- status icons (1.1) ----
// Draw precedence: render > image > icon (path is sugar for icon) > shape > symbol > dot. The export skips render and
// any image that is not a data: URL, and uses the highest static level present.
export const ICON_FIELDS = Object.freeze(["render", "image", "icon", "path", "shape", "symbol"]);
export const SHAPES = Object.freeze(["open", "pending", "decided", "parked", "blocked", "superseded"]);
export const ICON_LIMITS = Object.freeze({ nodes: 64, d: 8192 });

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// A host entry that sets any icon field replaces every inherited icon field; label, color and strike still inherit.
export function mergeStatus(base, own) {
  const b = isObj(base) ? base : {};
  const o = isObj(own) ? own : {};
  const replace = ICON_FIELDS.some((k) => o[k] !== undefined && o[k] !== null);
  const out = {};
  for (const [k, v] of Object.entries(b)) if (!(replace && ICON_FIELDS.includes(k))) out[k] = v;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

// statuses as given to createMindmap -> the effective map (every key merged with the default of the same key).
export function mergeStatuses(statuses) {
  if (!isObj(statuses) || !Object.keys(statuses).length) return { ...DEFAULT_STATUSES };
  const out = {};
  for (const [k, v] of Object.entries(statuses)) out[k] = mergeStatus(DEFAULT_STATUSES[k], v);
  return out;
}

export const isStrike = (s) => !!s && (s.strike === true || s.shape === "superseded");

const ICON_TAGS = new Set(["path", "circle", "ellipse", "line", "rect", "polyline", "polygon", "g"]);
// The geometry a node needs to draw anything; a node without it is dropped (an icon with nothing left falls back).
const REQUIRED = { path: ["d"], circle: ["r"], ellipse: ["rx", "ry"], rect: ["width", "height"], line: ["x1", "y1", "x2", "y2"], polyline: ["points"], polygon: ["points"] };
const NUM_ATTRS = new Set(["cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "x1", "y1", "x2", "y2"]);
const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const POINTS_RE = /^[0-9eE.,+\-\s]*$/;
const VIEWBOX_RE = /^\s*[-+]?[\d.]+(?:[\s,]+[-+]?[\d.]+){3}\s*$/;

// icon {viewBox?, nodes: [[tag, attrs, children?]], stroke?} -> {viewBox, stroke, nodes} | null (null: use the fallback).
// Unknown tags and attributes are dropped; over a cap (nodes, d length) or nothing left -> null.
export function sanitizeIcon(icon) {
  if (!isObj(icon) || !Array.isArray(icon.nodes)) return null;
  const viewBox = icon.viewBox === undefined ? "0 0 24 24" : icon.viewBox;
  if (typeof viewBox !== "string" || !VIEWBOX_RE.test(viewBox)) return null;
  let count = 0, over = false;
  const walk = (list) => {
    const out = [];
    for (const n of list) {
      if (++count > ICON_LIMITS.nodes) { over = true; return out; }
      if (!Array.isArray(n) || typeof n[0] !== "string" || !ICON_TAGS.has(n[0])) continue;
      const a = {}, fills = [];
      for (const [k, v] of Object.entries(isObj(n[1]) ? n[1] : {})) {
        const t = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : null;
        if (t === null) continue;
        if (NUM_ATTRS.has(k)) { if (NUM_RE.test(t)) a[k] = t; }
        else if (k === "d" || k === "points") {
          if (t.length > ICON_LIMITS.d) { over = true; return out; }
          if ((k === "d" ? D_RE : POINTS_RE).test(t)) a[k] = t;
        } else if (k === "fill") { if (t === "none") a.fill = "none"; else if (t === "currentColor") fills.push("fill"); }
      }
      const kids = n[0] === "g" && Array.isArray(n[2]) ? walk(n[2]) : [];
      if (over) return out;
      if (n[0] === "g" ? !kids.length : !REQUIRED[n[0]].every((k) => a[k] !== undefined && a[k] !== "")) continue;
      out.push({ t: n[0], a, fills, k: kids });
    }
    return out;
  };
  const nodes = walk(icon.nodes);
  if (over || !nodes.length) return null;
  return { viewBox: viewBox.trim(), stroke: icon.stroke === true, nodes };
}

const sanitized = new WeakMap(); // status entry -> {icon, path, value}
function iconOf(s) {
  const hit = sanitized.get(s);
  if (hit && hit.icon === s.icon && hit.path === s.path) return hit.value;
  let value = null;
  if (s.icon !== undefined && s.icon !== null) value = sanitizeIcon(s.icon);
  if (!value && typeof s.path === "string") value = sanitizeIcon({ viewBox: "0 0 12 12", nodes: [["path", { d: s.path }]] });
  sanitized.set(s, { icon: s.icon, path: s.path, value });
  return value;
}

const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i;
// image URL filter: data:image/(png|jpeg|gif|webp|svg+xml), https:, http:, blob:, or relative. Anything else -> null.
export function imageUrl(u) {
  if (typeof u !== "string") return null;
  const s = u.trim();
  if (!s || /[\u0000-\u001F\u007F]/.test(s)) return null;
  if (DATA_IMAGE.test(s)) return s;
  if (/[\s]/.test(s)) return null;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(s);
  if (!m) return s;
  return ["https", "http", "blob"].includes(m[1].toLowerCase()) ? s : null;
}

// The body of a sanitized icon in colour c: attributes + paint of the wrapper (<svg> or <symbol>) and its children.
function iconBody(ic, c) {
  const a = { viewBox: ic.viewBox, overflow: "visible" };
  const p = {};
  if (ic.stroke) { Object.assign(a, { fill: "none", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }); p.stroke = c; }
  else p.fill = c;
  const conv = (n) => el(n.t, n.a, { p: Object.fromEntries(n.fills.map((k) => [k, c])), k: n.k.map(conv) });
  return { a, p, k: ic.nodes.map(conv) };
}

// A sanitized icon drawn 12 x 12 centred at cx, cy as a nested <svg> (statusIcon, menu icons).
export function iconSpec(ic, c, cx, cy) {
  const b = iconBody(ic, c);
  return el("svg", { x: cx - 6, y: cy - 6, width: 12, height: 12, ...b.a }, { p: b.p, k: b.k });
}

// The <symbol> of an icon or image level (A1: defined once per view, every node draws a <use>).
function symbolSpec(id, lv, c) {
  if (lv.level === "image") {
    return el("symbol", { id, viewBox: "0 0 12 12" }, { k: [el("image", { href: lv.url, x: 0, y: 0, width: 12, height: 12, preserveAspectRatio: "xMidYMid meet" })] });
  }
  const b = iconBody(lv.icon, c);
  return el("symbol", { id, ...b.a }, { p: b.p, k: b.k });
}

// A registry of status symbols for one view: symbolFor(key, make) -> id; `defs` lists the <symbol> specs in first-use
// order. Ids are `<prefix>-<n>` (n = first-use index), never derived from the status key.
export function symbolRegistry(prefix) {
  const ids = new Map();
  const defs = [];
  return {
    defs,
    symbolFor(key, make) {
      if (!ids.has(key)) { const id = `${prefix}-${ids.size}`; ids.set(key, id); defs.push(make(id)); }
      return ids.get(key);
    },
  };
}

// Which level draws status `key`: {level: "render" | "image" | "icon" | "shape" | "symbol" | "dot", url?, icon?}.
// o.export: the static export rules; o.rendered(key): true when the component holds a rendered element for the key.
export function statusLevel(key, statuses, o = {}) {
  const s = statuses && statuses[key];
  if (!s) return null;
  if (!o.export && typeof s.render === "function" && o.rendered && o.rendered(key)) return { level: "render" };
  if (s.image !== undefined && s.image !== null) {
    const url = imageUrl(s.image);
    if (url && (!o.export || DATA_IMAGE.test(url))) return { level: "image", url };
  }
  const icon = (s.icon !== undefined && s.icon !== null) || s.path !== undefined ? iconOf(s) : null;
  if (icon) return { level: "icon", icon };
  if (SHAPES.includes(s.shape)) return { level: "shape" };
  if (typeof s.symbol === "string" && s.symbol !== "") return { level: "symbol" };
  return { level: "dot" };
}

export const DEFAULT_STRINGS = Object.freeze({
  hidden: "{n} hidden children",
  linkBlocks: "blocks", linkSupersedes: "supersedes", linkRelates: "relates to",
});

export function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)); }

const r2 = (v) => Math.round(v * 100) / 100;
const paint = (tok) => (TOKENS.includes(tok) ? { tok } : { raw: String(tok) });
const el = (t, a = {}, extra = {}) => ({ t, a, ...extra });

// A status symbol (or tone dot) centred at cx, cy. o: {export, rendered} as for statusLevel; o.symbols (a registry):
// icon and image levels become <use> of a shared <symbol>; without it they are drawn inline.
export function statusShape(key, statuses, cx, cy, o = {}) {
  const s = statuses[key];
  if (!s) return null;
  const c = paint(s.color || "grey");
  const ring = el("circle", { cx, cy, r: 5, fill: "none", "stroke-width": 1.5 }, { p: { stroke: c } });
  const kids = [];
  const lv = statusLevel(key, statuses, o);
  if (lv.level === "render") kids.push(el("svg", { x: cx - 6, y: cy - 6, width: 12, height: 12, viewBox: "0 0 12 12", overflow: "visible" }, { c: "mm-status-render", rk: key }));
  else if ((lv.level === "image" || lv.level === "icon") && o.symbols) {
    const id = o.symbols.symbolFor(key, (sid) => symbolSpec(sid, lv, c));
    kids.push(el("use", { href: `#${id}`, x: cx - 6, y: cy - 6, width: 12, height: 12 }));
  } else if (lv.level === "image") kids.push(el("image", { href: lv.url, x: cx - 6, y: cy - 6, width: 12, height: 12, preserveAspectRatio: "xMidYMid meet" }));
  else if (lv.level === "icon") kids.push(iconSpec(lv.icon, c, cx, cy));
  else switch (lv.level === "shape" ? s.shape : null) {
    case "open": kids.push(ring); break;
    case "pending": kids.push(ring, el("path", { d: `M${cx} ${cy - 5}A5 5 0 0 0 ${cx} ${cy + 5}Z` }, { p: { fill: c } })); break;
    case "decided": kids.push(el("path", { d: `M${cx - 4} ${cy}L${cx - 1} ${cy + 3}L${cx + 4.5} ${cy - 3.5}`, fill: "none", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, { p: { stroke: c } })); break;
    case "parked": kids.push(el("path", { d: `M${cx - 2} ${cy - 4}V${cy + 4}M${cx + 2} ${cy - 4}V${cy + 4}`, "stroke-width": 2 }, { p: { stroke: c } })); break;
    case "blocked": kids.push(ring, el("path", { d: `M${cx - 3.5} ${cy + 3.5}L${cx + 3.5} ${cy - 3.5}`, "stroke-width": 1.5 }, { p: { stroke: c } })); break;
    case "superseded": kids.push(el("path", { d: `M${cx - 4} ${cy}H${cx + 4}`, "stroke-width": 2, "stroke-linecap": "round" }, { p: { stroke: c } })); break;
    default:
      kids.push(el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": FONT_SIZE.small }, { p: { fill: c }, x: lv.level === "symbol" ? s.symbol : "\u25CF" }));
  }
  if (s.label) kids.push(el("title", {}, { x: s.label }));
  return el("g", {}, { c: "mm-status", k: kids });
}

function toneDot(tone, cx, cy) { return el("circle", { cx, cy, r: 4 }, { c: "mm-tone", p: { fill: paint(tone) } }); }

function edgePath(p, c, view) {
  if (view === "outline") {
    const x = p.x + 10, y0 = p.y + p.h, y1 = c.y + c.h / 2;
    return `M${r2(x)} ${r2(y0)}V${r2(y1)}H${r2(c.x)}`;
  }
  const s = c.side < 0 ? -1 : 1;
  const sx = s > 0 ? p.x + p.w : p.x, sy = p.y + p.h / 2;
  const ex = s > 0 ? c.x : c.x + c.w, ey = c.y + c.h / 2;
  const mx = (sx + ex) / 2;
  return `M${r2(sx)} ${r2(sy)}C${r2(mx)} ${r2(sy)} ${r2(mx)} ${r2(ey)} ${r2(ex)} ${r2(ey)}`;
}

// scene(data, lay, opts) -> {bounds, defs, edges, links, nodes}: arrays of element specs
// opts: statuses, strings, selected, hits (Set), current, dim (Set of ids to fade), links ("default" | "all"),
//       interactive (adds collapse toggles), uid (prefix for marker ids), export (static icon rules),
//       rendered(key) (the component holds a render() element for the status)
export function scene(data, lay, opts = {}) {
  const statuses = opts.statuses || DEFAULT_STATUSES;
  const strings = { ...DEFAULT_STRINGS, ...(opts.strings || {}) };
  const uid = opts.uid || "mm";
  const idx = indexTree(data);
  const symbols = symbolRegistry(`${uid}-s`);
  const edges = lay.edges.map((e) => {
    const p = lay.boxes.get(e.from), c = lay.boxes.get(e.to);
    return el("path", { d: edgePath(p, c, lay.view), fill: "none", "stroke-width": p.root ? 2 : 1.5 }, { c: "mm-edge", p: { stroke: paint(`edge-${(e.branch ?? 0) % 8}`) } });
  });

  // links: an end inside a collapsed branch stops at the nearest visible ancestor (hollow dot)
  const visible = (id) => { let e = idx.get(id); while (e && !lay.boxes.has(e.id)) e = e.parentId ? idx.get(e.parentId) : null; return e ? lay.boxes.get(e.id) : null; };
  const links = [];
  const defs = [];
  const used = new Set();
  for (const l of data.links || []) {
    if (opts.links !== "all" && l.type !== "blocks" && opts.selected !== l.from && opts.selected !== l.to) continue;
    const a = visible(l.from), b = visible(l.to);
    if (!a || !b || a === b) continue;
    const tok = `link-${l.type}`;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    // end points on the box border, along the centre line
    const clipTo = (bx0, x, y, tx, ty) => {
      const dx = tx - x, dy = ty - y; const hw = bx0.w / 2, hh = bx0.h / 2;
      const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity, 1);
      return [x + dx * t, y + dy * t];
    };
    const [sx, sy] = clipTo(a, ax, ay, bx, by), [ex, ey] = clipTo(b, bx, by, ax, ay);
    const mx = (sx + ex) / 2 - (ey - sy) * 0.15, my = (sy + ey) / 2 + (ex - sx) * 0.15;
    const attrs = { d: `M${r2(sx)} ${r2(sy)}Q${r2(mx)} ${r2(my)} ${r2(ex)} ${r2(ey)}`, fill: "none", "stroke-width": l.type === "relates" ? 1 : 1.5 };
    if (l.type === "relates") attrs["stroke-dasharray"] = "4 3";
    else { attrs["marker-end"] = `url(#${uid}-arrow-${l.type})`; used.add(l.type); }
    const label = { relates: strings.linkRelates, blocks: strings.linkBlocks, supersedes: strings.linkSupersedes }[l.type];
    const kids = [el("path", attrs, { p: { stroke: paint(tok) } }), el("title", {}, { x: l.label ? `${label}: ${l.label}` : label })];
    if (b !== lay.boxes.get(l.to)) kids.push(el("circle", { cx: r2(ex), cy: r2(ey), r: 3, "stroke-width": 1.5 }, { p: { stroke: paint(tok), fill: paint("bg") } }));
    if (a !== lay.boxes.get(l.from)) kids.push(el("circle", { cx: r2(sx), cy: r2(sy), r: 3, "stroke-width": 1.5 }, { p: { stroke: paint(tok), fill: paint("bg") } }));
    if (l.label) kids.push(el("text", { x: r2((sx + ex) / 2 + (mx - (sx + ex) / 2) / 2), y: r2((sy + ey) / 2 + (my - (sy + ey) / 2) / 2), "text-anchor": "middle", "font-size": FONT_SIZE.small }, { c: "mm-link-label", p: { fill: paint("muted") }, x: l.label }));
    links.push(el("g", {}, { c: `mm-link mm-link-${l.type}`, k: kids }));
  }
  for (const type of used) {
    defs.push(el("marker", { id: `${uid}-arrow-${type}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      { k: [el("path", { d: "M0 0L10 5L0 10Z" }, { p: { fill: paint(`link-${type}`) } })] }));
  }

  const nodes = lay.order.map((b) => {
    const e = idx.get(b.id); const n = e.node;
    const kids = [];
    const cls = ["mm-node"];
    if (b.root) cls.push("mm-root");
    if (opts.selected === b.id) cls.push("is-selected");
    if (opts.hits && opts.hits.has(b.id)) cls.push("is-hit");
    if (opts.current === b.id) cls.push("is-current");
    if (opts.dim && opts.dim.has(b.id)) cls.push("is-dim");
    const sup = n.status && isStrike(statuses[n.status]);
    if (sup) cls.push("is-superseded");
    const fill = opts.current === b.id ? "hit-current" : opts.hits && opts.hits.has(b.id) ? "hit" : b.root ? "root-bg" : "node-bg";
    const rect = { width: b.w, height: b.h, rx: b.root ? 8 : 6, "stroke-width": b.root ? 0 : 1.25 };
    kids.push(el("rect", rect, { c: "mm-box", p: { fill: paint(fill), ...(b.root ? {} : { stroke: paint(`edge-${(b.branch ?? 0) % 8}`) }) } }));
    if (opts.selected === b.id) kids.push(el("rect", { x: -3, y: -3, width: b.w + 6, height: b.h + 6, rx: 8, fill: "none", "stroke-width": 2 }, { c: "mm-sel", p: { stroke: paint("select") } }));
    const cy = b.h / 2;
    if (!b.root) {
      const sx = GEOM.padX + GEOM.sym / 2;
      if (n.status) { const s = statusShape(n.status, statuses, sx, cy, { export: opts.export, rendered: opts.rendered, symbols }); if (s) kids.push(s); }
      else if (n.tone) kids.push(toneDot(n.tone, sx, cy));
    }
    if (b.num) kids.push(el("text", { x: b.numX, y: cy, "dominant-baseline": "central", "font-size": FONT_SIZE.num, "font-family": MONO }, { c: "mm-num", p: { fill: paint("muted") }, x: b.num }));
    const ta = { x: b.labelX, y: cy, "dominant-baseline": "central", "font-size": b.root ? FONT_SIZE.root : FONT_SIZE.node };
    if (b.root) ta["font-weight"] = 600;
    if (sup) ta.opacity = 0.55;
    kids.push(el("text", ta, { c: "mm-label", p: { fill: paint(b.root ? "root-text" : "text") }, x: b.label }));
    if (sup) kids.push(el("path", { d: `M${b.labelX} ${r2(cy)}h${b.labelW}`, "stroke-width": 1, opacity: 0.55 }, { p: { stroke: paint("text") } }));
    if (b.badge) {
      const bk = [el("text", { x: b.badgeX, y: cy, "dominant-baseline": "central", "font-size": FONT_SIZE.small }, { p: { fill: paint(b.root ? "root-text" : "muted") }, x: String(b.badge.symbol) })];
      if (b.badge.label) bk.push(el("title", {}, { x: String(b.badge.label) }));
      kids.push(el("g", {}, { c: "mm-badge", k: bk }));
    }
    if (b.chip) {
      kids.push(el("g", { "data-toggle": b.id }, { c: "mm-chip", k: [
        el("rect", { x: b.chipX, y: cy - 9, width: b.chipW, height: 18, rx: 9 }, { p: { fill: paint("chip-bg") } }),
        el("text", { x: b.chipX + b.chipW / 2, y: cy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": FONT_SIZE.small }, { p: { fill: paint("text") }, x: b.chip }),
        el("title", {}, { x: fmt(strings.hidden, { n: b.hidden }) }),
      ] }));
    }
    if (opts.interactive && b.hasKids && !b.hidden && lay.view !== "outline") {
      const tx = b.side < 0 ? 0 : b.w;
      kids.push(el("g", { "data-toggle": b.id }, { c: "mm-toggle", k: [
        el("circle", { cx: tx, cy, r: 6, "stroke-width": 1 }, { p: { fill: paint("bg"), stroke: paint("node-border") } }),
        el("path", { d: `M${tx - 3} ${cy}H${tx + 3}`, "stroke-width": 1.5 }, { p: { stroke: paint("muted") } }),
      ] }));
    }
    kids.push(el("title", {}, { x: n.title }));
    const ga = { transform: `translate(${r2(b.x)},${r2(b.y)})`, "data-id": b.id };
    if (opts.dim && opts.dim.has(b.id)) ga.opacity = 0.35;
    return el("g", ga, { c: cls.join(" "), k: kids });
  });
  return { bounds: lay.bounds, defs: [...defs, ...symbols.defs], edges, links, nodes };
}

// ---- serialisation ----

const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export function escapeXml(s) {
  return String(s).replace(XML_BAD, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const ATTR_NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

// Colour syntax the export writes: #hex, a colour function (rgb ... oklch, and color(), which browsers give for a
// computed color-mix) with plain arguments (no nested function, so no var() or
// url()), or a colour name / keyword. Anything else (var(...), url(...), color-mix(...)) cannot be written as is.
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([-+0-9.eE%\s,/a-z]*\)$/i;
const NAME_COLOR = /^[a-z]{3,24}$/i;
export function isColor(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return HEX_COLOR.test(s) || FN_COLOR.test(s) || NAME_COLOR.test(s);
}

// A paint in the export: a token value or raw colour that is not colour syntax falls back (token: the default palette;
// raw: the grey token), so the file never holds var(...) or url(...).
export function resolvePaint(v, theme) {
  if (v.tok) { const t = theme[v.tok]; return isColor(t) ? t.trim() : THEME[v.tok]; }
  if (isColor(v.raw)) return v.raw.trim();
  return isColor(theme.grey) ? theme.grey.trim() : THEME.grey;
}

export function serialize(spec, theme = THEME) {
  const attrs = { ...spec.a };
  for (const [k, v] of Object.entries(spec.p || {})) attrs[k] = resolvePaint(v, theme);
  let s = "<" + spec.t;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || !ATTR_NAME.test(k)) continue;
    s += ` ${k}="${escapeXml(v)}"`;
  }
  const inner = (spec.x !== undefined ? escapeXml(spec.x) : "") + (spec.k || []).map((c) => serialize(c, theme)).join("");
  return inner ? `${s}>${inner}</${spec.t}>` : `${s}/>`;
}

// toSVG(json, {view, theme, measure, collapsed, focus, statuses, strings, badge, links, selected, filter, padding, idPrefix})
// -> string | null. idPrefix ([A-Za-z][A-Za-z0-9_-]{0,31}, default "mm") starts every id in the file: <prefix>-s-<i>
// for icons, <prefix>-arrow-<type> for markers; give each file inlined into one page its own.
export const ID_PREFIX = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
export function toSVG(json, opts = {}) {
  const v = validate(json, { statuses: opts.statuses, limits: opts.limits });
  if (!v.ok) return null;
  const data = v.data;
  const statuses = opts.statuses || DEFAULT_STATUSES;
  const lay = layout(data, { view: opts.view || data.layout || "both", collapsed: opts.collapsed, focus: opts.focus, measure: opts.measure, badge: opts.badge });
  let dim = null;
  if (Array.isArray(opts.filter)) { dim = new Set(); for (const [id, e] of indexTree(data)) if (!e.node.status || !opts.filter.includes(e.node.status)) dim.add(id); }
  const uid = typeof opts.idPrefix === "string" && ID_PREFIX.test(opts.idPrefix) ? opts.idPrefix : "mm";
  const sc = scene(data, lay, { statuses, strings: opts.strings, selected: opts.selected, links: opts.links, uid, dim, export: true });
  const theme = { ...THEME, ...(opts.theme || {}) };
  const pad = opts.padding ?? 20;
  const { x0, y0, w, h } = lay.bounds;
  const W = r2(w + pad * 2), H = r2(h + pad * 2);
  const root = el("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: `${r2(x0 - pad)} ${r2(y0 - pad)} ${W} ${H}`, width: W, height: H, "font-family": FONT }, {
    k: [
      ...(data.title ? [el("title", {}, { x: data.title })] : []),
      el("rect", { x: r2(x0 - pad), y: r2(y0 - pad), width: W, height: H }, { p: { fill: paint("bg") } }),
      ...(sc.defs.length ? [el("defs", {}, { k: sc.defs })] : []),
      el("g", {}, { c: "mm-edges", k: sc.edges }),
      el("g", {}, { c: "mm-links", k: sc.links }),
      el("g", {}, { c: "mm-nodes", k: sc.nodes }),
    ],
  });
  return serialize(stripClasses(root), theme);
}

function stripClasses(s) { const { c, ...rest } = s; return { ...rest, k: (s.k || []).map(stripClasses) }; }

// statusIcon(key, statuses, theme) -> a standalone 12 x 12 <svg> string drawn with the export rules (render skipped,
// image only as data:), for a host legend or filter chip. statuses as given to createMindmap; null for an unknown key.
export function statusIcon(key, statuses, theme) {
  const st = mergeStatuses(statuses);
  const g = statusShape(key, st, 6, 6, { export: true });
  if (!g) return null;
  const root = el("svg", { xmlns: "http://www.w3.org/2000/svg", width: 12, height: 12, viewBox: "0 0 12 12", overflow: "visible" }, { k: [g] });
  return serialize(stripClasses(root), { ...THEME, ...(isObj(theme) ? theme : {}) });
}

// A deterministic fake text measurer (for node / tests): grapheme count x a constant per kind.
export function fakeMeasure(text, kind) {
  const n = graphemes(String(text)).length;
  return n * (kind === "root" ? 9 : kind === "num" ? 6.6 : kind === "small" ? 6.5 : 7.5);
}
