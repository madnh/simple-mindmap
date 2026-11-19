// Scene building and static SVG export. Pure: runs in node with any measure function.
// The interactive component draws the same scene into the DOM (colours as CSS variables);
// toSVG serialises it with concrete theme colours so the file opens anywhere.
import { validate, indexTree, graphemes } from "./model.js";
import { layout, GEOM } from "./layout.js";

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
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
  superseded: { label: "Superseded", shape: "superseded", color: "grey" },
});

export const DEFAULT_STRINGS = Object.freeze({
  hidden: "{n} hidden children",
  linkBlocks: "blocks", linkSupersedes: "supersedes", linkRelates: "relates to",
});

export function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)); }

const r2 = (v) => Math.round(v * 100) / 100;
const paint = (tok) => (TOKENS.includes(tok) ? { tok } : { raw: String(tok) });
const el = (t, a = {}, extra = {}) => ({ t, a, ...extra });

// A status symbol (or tone dot) centred at cx, cy.
export function statusShape(key, statuses, cx, cy) {
  const s = statuses[key];
  if (!s) return null;
  const c = paint(s.color || "grey");
  const ring = el("circle", { cx, cy, r: 5, fill: "none", "stroke-width": 1.5 }, { p: { stroke: c } });
  const kids = [];
  switch (s.shape) {
    case "open": kids.push(ring); break;
    case "pending": kids.push(ring, el("path", { d: `M${cx} ${cy - 5}A5 5 0 0 0 ${cx} ${cy + 5}Z` }, { p: { fill: c } })); break;
    case "decided": kids.push(el("path", { d: `M${cx - 4} ${cy}L${cx - 1} ${cy + 3}L${cx + 4.5} ${cy - 3.5}`, fill: "none", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, { p: { stroke: c } })); break;
    case "parked": kids.push(el("path", { d: `M${cx - 2} ${cy - 4}V${cy + 4}M${cx + 2} ${cy - 4}V${cy + 4}`, "stroke-width": 2 }, { p: { stroke: c } })); break;
    case "blocked": kids.push(ring, el("path", { d: `M${cx - 3.5} ${cy + 3.5}L${cx + 3.5} ${cy - 3.5}`, "stroke-width": 1.5 }, { p: { stroke: c } })); break;
    case "superseded": kids.push(el("path", { d: `M${cx - 4} ${cy}H${cx + 4}`, "stroke-width": 2, "stroke-linecap": "round" }, { p: { stroke: c } })); break;
    default:
      kids.push(el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": FONT_SIZE.small }, { p: { fill: c }, x: s.symbol || "\u25CF" }));
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
//       interactive (adds collapse toggles), uid (prefix for marker ids)
export function scene(data, lay, opts = {}) {
  const statuses = opts.statuses || DEFAULT_STATUSES;
  const strings = { ...DEFAULT_STRINGS, ...(opts.strings || {}) };
  const uid = opts.uid || "mm";
  const idx = indexTree(data);
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
    const sup = n.status && statuses[n.status] && statuses[n.status].shape === "superseded";
    if (sup) cls.push("is-superseded");
    const fill = opts.current === b.id ? "hit-current" : opts.hits && opts.hits.has(b.id) ? "hit" : b.root ? "root-bg" : "node-bg";
    const rect = { width: b.w, height: b.h, rx: b.root ? 8 : 6, "stroke-width": b.root ? 0 : 1.25 };
    kids.push(el("rect", rect, { c: "mm-box", p: { fill: paint(fill), ...(b.root ? {} : { stroke: paint(`edge-${(b.branch ?? 0) % 8}`) }) } }));
    if (opts.selected === b.id) kids.push(el("rect", { x: -3, y: -3, width: b.w + 6, height: b.h + 6, rx: 8, fill: "none", "stroke-width": 2 }, { c: "mm-sel", p: { stroke: paint("select") } }));
    const cy = b.h / 2;
    if (!b.root) {
      const sx = GEOM.padX + GEOM.sym / 2;
      if (n.status) { const s = statusShape(n.status, statuses, sx, cy); if (s) kids.push(s); }
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
  return { bounds: lay.bounds, defs, edges, links, nodes };
}

// ---- serialisation ----

const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export function escapeXml(s) {
  return String(s).replace(XML_BAD, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const ATTR_NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

export function resolvePaint(v, theme) {
  if (v.tok) return theme[v.tok] ?? THEME[v.tok];
  return v.raw;
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

// toSVG(json, {view, theme, measure, collapsed, focus, statuses, strings, badge, links, selected, filter, padding}) -> string | null
export function toSVG(json, opts = {}) {
  const v = validate(json, { statuses: opts.statuses, limits: opts.limits });
  if (!v.ok) return null;
  const data = v.data;
  const statuses = opts.statuses || DEFAULT_STATUSES;
  const lay = layout(data, { view: opts.view || data.layout || "both", collapsed: opts.collapsed, focus: opts.focus, measure: opts.measure, badge: opts.badge });
  let dim = null;
  if (Array.isArray(opts.filter)) { dim = new Set(); for (const [id, e] of indexTree(data)) if (!e.node.status || !opts.filter.includes(e.node.status)) dim.add(id); }
  const sc = scene(data, lay, { statuses, strings: opts.strings, selected: opts.selected, links: opts.links, uid: "mm", dim });
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

// A deterministic fake text measurer (for node / tests): grapheme count x a constant per kind.
export function fakeMeasure(text, kind) {
  const n = graphemes(String(text)).length;
  return n * (kind === "root" ? 9 : kind === "num" ? 6.6 : kind === "small" ? 6.5 : 7.5);
}
