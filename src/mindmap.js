// The interactive component: draws the map (both / right) or the outline, handles user input, emits events.
// The host owns the data: in "edit" mode the component only emits `intent`; the host calls apply() once written.
import { validate, indexTree, clone, VIEWS, countNodes } from "./model.js";
import { applyOps } from "./ops.js";
import { layout } from "./layout.js";
import { scene, toSVG, DEFAULT_STRINGS, THEME, TOKENS, FONT, MONO, FONT_SIZE, fmt, mergeStatus, mergeStatuses, sanitizeIcon, iconSpec } from "./svg.js";
import { toOutline, toMermaid } from "./export.js";
import { buildOutline, specToDom } from "./outline.js";

export { validate, applyOps, toSVG, toOutline, toMermaid, layout };
export { fromOutline } from "./export.js";
export { pathOf, ERROR_CODES, DEFAULT_LIMITS } from "./model.js";
export { DEFAULT_STATUSES, THEME, DARK_THEME, statusIcon } from "./svg.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_ID = "simple-mindmap-css";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// theme tokens accepted by theme {tokens} / setTheme: the 28 colour tokens plus font and mono (--mm-<name>)
const THEME_TOKENS = [...TOKENS, "font", "mono"];
const STYLE_FIELDS = ["label", "color", "strike", "icon", "path", "image", "render", "symbol", "shape"];
const LARGE = 80;

// Generated from src/mindmap.css by `npm run sync-css`; a unit test fails when the two differ.
/*CSS-BEGIN*/export const CSS = "/* Defaults live under private names (--mmd-*, not part of the API) with zero specificity.\n   Every use reads var(--mm-x, var(--mmd-x)), so a --mm-* set by the host on .simple-mindmap\n   or on any ancestor wins in every theme. */\n:where(.simple-mindmap) {\n  --mmd-bg: #ffffff; --mmd-text: #1f2328; --mmd-muted: #6e7781; --mmd-node-bg: #ffffff; --mmd-node-border: #d0d7de;\n  --mmd-root-bg: #24292f; --mmd-root-text: #ffffff; --mmd-select: #0969da; --mmd-hit: #fff1a8; --mmd-hit-current: #ffd33d;\n  --mmd-chip-bg: #eaeef2;\n  --mmd-green: #1a7f37; --mmd-amber: #bf8700; --mmd-red: #cf222e; --mmd-blue: #0969da; --mmd-purple: #8250df; --mmd-grey: #6e7781;\n  --mmd-link-blocks: #cf222e; --mmd-link-supersedes: #6e7781; --mmd-link-relates: #8c959f;\n  --mmd-edge-0: #4c8bf5; --mmd-edge-1: #e8710a; --mmd-edge-2: #1e8e3e; --mmd-edge-3: #a142f4;\n  --mmd-edge-4: #d93025; --mmd-edge-5: #12a4af; --mmd-edge-6: #c26401; --mmd-edge-7: #5f6368;\n  --mmd-font: -apple-system, BlinkMacSystemFont, system-ui, \"Helvetica Neue\", sans-serif;\n  --mmd-mono: ui-monospace, \"SF Mono\", Menlo, monospace;\n}\n:where(.simple-mindmap[data-theme=\"dark\"]) {\n  --mmd-bg: #0d1117; --mmd-text: #e6edf3; --mmd-muted: #8b949e; --mmd-node-bg: #161b22; --mmd-node-border: #30363d;\n  --mmd-root-bg: #e6edf3; --mmd-root-text: #0d1117; --mmd-select: #58a6ff; --mmd-hit: #5a4a00; --mmd-hit-current: #9e7700;\n  --mmd-chip-bg: #30363d; --mmd-green: #3fb950; --mmd-amber: #d29922; --mmd-red: #f85149; --mmd-blue: #58a6ff;\n  --mmd-purple: #bc8cff; --mmd-grey: #8b949e; --mmd-link-blocks: #f85149; --mmd-link-supersedes: #8b949e; --mmd-link-relates: #6e7681;\n}\n@media (prefers-color-scheme: dark) {\n  :where(.simple-mindmap:not([data-theme=\"light\"])) {\n    --mmd-bg: #0d1117; --mmd-text: #e6edf3; --mmd-muted: #8b949e; --mmd-node-bg: #161b22; --mmd-node-border: #30363d;\n    --mmd-root-bg: #e6edf3; --mmd-root-text: #0d1117; --mmd-select: #58a6ff; --mmd-hit: #5a4a00; --mmd-hit-current: #9e7700;\n    --mmd-chip-bg: #30363d; --mmd-green: #3fb950; --mmd-amber: #d29922; --mmd-red: #f85149; --mmd-blue: #58a6ff;\n    --mmd-purple: #bc8cff; --mmd-grey: #8b949e; --mmd-link-blocks: #f85149; --mmd-link-supersedes: #8b949e; --mmd-link-relates: #6e7681;\n  }\n}\n.simple-mindmap {\n  position: relative; overflow: hidden; box-sizing: border-box; width: 100%; height: 100%; min-height: 240px;\n  background: var(--mm-bg, var(--mmd-bg)); color: var(--mm-text, var(--mmd-text)); font-family: var(--mm-font, var(--mmd-font)); font-size: 13px; line-height: 1.35;\n  outline: none; -webkit-user-select: none; user-select: none;\n}\n.simple-mindmap *, .simple-mindmap *::before, .simple-mindmap *::after { box-sizing: border-box; }\n.simple-mindmap:focus-visible { box-shadow: inset 0 0 0 2px var(--mm-select, var(--mmd-select)); }\n.simple-mindmap .mm-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }\n.simple-mindmap .mm-canvas.is-panning { cursor: grabbing; }\n.simple-mindmap .mm-viewport { transform-origin: 0 0; }\n.simple-mindmap .mm-node { cursor: default; }\n.simple-mindmap[data-mode=\"select\"] .mm-node, .simple-mindmap[data-mode=\"edit\"] .mm-node { cursor: pointer; }\n.simple-mindmap .mm-node.is-dragging { opacity: 0.6; pointer-events: none; }\n.simple-mindmap .mm-node.is-drop .mm-box { stroke: var(--mm-select, var(--mmd-select)) !important; stroke-width: 2.5; }\n.simple-mindmap .mm-toggle, .simple-mindmap .mm-chip { cursor: pointer; }\n.simple-mindmap .mm-btn {\n  border: 1px solid var(--mm-node-border, var(--mmd-node-border)); background: var(--mm-node-bg, var(--mmd-node-bg)); color: var(--mm-text, var(--mmd-text)); border-radius: 6px;\n  font: inherit; font-size: 12px; line-height: 1.2; padding: 4px 8px; cursor: pointer; min-width: 26px;\n}\n.simple-mindmap .mm-btn:hover { background: var(--mm-chip-bg, var(--mmd-chip-bg)); }\n.simple-mindmap .mm-btn:disabled { opacity: 0.45; cursor: default; }\n.simple-mindmap .mm-btn[aria-pressed=\"true\"] { background: var(--mm-select, var(--mmd-select)); border-color: var(--mm-select, var(--mmd-select)); color: var(--mm-bg, var(--mmd-bg)); }\n.simple-mindmap .mm-btn:focus-visible, .simple-mindmap .mm-menu button:focus-visible { outline: 2px solid var(--mm-select, var(--mmd-select)); outline-offset: 1px; }\n.simple-mindmap .mm-group { display: inline-flex; gap: 0; }\n.simple-mindmap .mm-group .mm-btn { border-radius: 0; margin-left: -1px; }\n.simple-mindmap .mm-group .mm-btn:first-child { border-radius: 6px 0 0 6px; margin-left: 0; }\n.simple-mindmap .mm-group .mm-btn:last-child { border-radius: 0 6px 6px 0; }\n.simple-mindmap .mm-search {\n  position: absolute; top: 8px; left: 8px; z-index: 2; display: flex; align-items: center; gap: 4px;\n  background: var(--mm-node-bg, var(--mmd-node-bg)); border: 1px solid var(--mm-node-border, var(--mmd-node-border)); border-radius: 6px; padding: 2px 4px;\n}\n.simple-mindmap .mm-search input {\n  border: 0; background: transparent; color: inherit; font: inherit; width: 13em; padding: 3px 4px; outline: none; min-width: 0;\n}\n.simple-mindmap .mm-search .mm-count { color: var(--mm-muted, var(--mmd-muted)); font-size: 12px; white-space: nowrap; }\n.simple-mindmap .mm-search .mm-btn { border: 0; padding: 2px 6px; }\n.simple-mindmap .mm-tools { position: absolute; top: 8px; right: 8px; z-index: 2; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }\n.simple-mindmap .mm-zoom { position: absolute; bottom: 8px; right: 8px; z-index: 2; display: flex; gap: 4px; }\n.simple-mindmap .mm-crumbs {\n  position: absolute; bottom: 8px; left: 8px; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 2px;\n  max-width: calc(100% - 220px); font-size: 12px; color: var(--mm-muted, var(--mmd-muted));\n}\n.simple-mindmap .mm-crumbs .mm-btn { padding: 2px 6px; max-width: 16em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.simple-mindmap .mm-more { position: absolute; z-index: 2; padding: 0 6px; height: 22px; line-height: 1; }\n.simple-mindmap .mm-menu {\n  position: absolute; z-index: 3; display: flex; flex-direction: column; min-width: 11em; padding: 4px;\n  background: var(--mm-node-bg, var(--mmd-node-bg)); border: 1px solid var(--mm-node-border, var(--mmd-node-border)); border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);\n}\n.simple-mindmap .mm-menu button {\n  border: 0; background: transparent; color: var(--mm-text, var(--mmd-text)); font: inherit; text-align: left; padding: 5px 8px; border-radius: 5px; cursor: pointer;\n}\n.simple-mindmap .mm-menu .mm-icon { display: inline-block; min-width: 1.4em; margin-right: 4px; text-align: center; }\n.simple-mindmap .mm-menu button:hover { background: var(--mm-chip-bg, var(--mmd-chip-bg)); }\n.simple-mindmap .mm-rename {\n  position: absolute; z-index: 3; font: inherit; color: var(--mm-text, var(--mmd-text)); background: var(--mm-node-bg, var(--mmd-node-bg));\n  border: 2px solid var(--mm-select, var(--mmd-select)); border-radius: 6px; padding: 3px 6px; min-width: 8em; -webkit-user-select: text; user-select: text;\n}\n.simple-mindmap .mm-error { padding: 16px; }\n.simple-mindmap .mm-error-title { font-weight: 600; }\n.simple-mindmap .mm-error-detail { color: var(--mm-muted, var(--mmd-muted)); margin-top: 4px; overflow-wrap: anywhere; }\n.simple-mindmap .mm-outline { position: absolute; inset: 0; overflow: auto; padding: 8px 12px 24px; }\n.simple-mindmap .mm-outline .mm-search { position: static; display: inline-flex; margin: 0 0 6px; }\n.simple-mindmap .mm-outline-head { display: flex; align-items: center; gap: 8px; padding-right: 150px; min-height: 34px; }\n.simple-mindmap .mm-tree, .simple-mindmap .mm-tree ul { list-style: none; margin: 0; padding: 0; }\n.simple-mindmap .mm-tree ul { padding-left: 22px; }\n.simple-mindmap .mm-row { display: flex; align-items: flex-start; gap: 6px; padding: 3px 6px; border-radius: 6px; cursor: default; }\n.simple-mindmap[data-mode=\"select\"] .mm-row, .simple-mindmap[data-mode=\"edit\"] .mm-row { cursor: pointer; }\n.simple-mindmap .mm-row.is-selected { box-shadow: inset 0 0 0 2px var(--mm-select, var(--mmd-select)); }\n.simple-mindmap .mm-row.is-hit { background: var(--mm-hit, var(--mmd-hit)); }\n.simple-mindmap .mm-row.is-current { background: var(--mm-hit-current, var(--mmd-hit-current)); }\n.simple-mindmap .mm-row.is-root .mm-title { font-weight: 600; font-size: 15px; }\n.simple-mindmap .mm-row .mm-num { font-family: var(--mm-mono, var(--mmd-mono)); font-size: 11px; color: var(--mm-muted, var(--mmd-muted)); padding-top: 2px; white-space: nowrap; }\n.simple-mindmap .mm-row .mm-title { white-space: normal; overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }\n.simple-mindmap .mm-row .mm-badge { color: var(--mm-muted, var(--mmd-muted)); font-size: 11px; padding-top: 2px; }\n.simple-mindmap .mm-row.is-dim { opacity: 0.35; }\n.simple-mindmap .mm-row.is-superseded .mm-title { text-decoration: line-through; opacity: 0.55; }\n.simple-mindmap .mm-arrow {\n  flex: none; width: 16px; height: 18px; border: 0; padding: 0; background: none; color: var(--mm-muted, var(--mmd-muted)); cursor: pointer; font-size: 11px;\n}\n.simple-mindmap .mm-arrow[aria-expanded=\"true\"] { transform: rotate(90deg); }\n.simple-mindmap .mm-arrow-pad { flex: none; width: 16px; }\n.simple-mindmap .mm-sym { flex: none; width: 12px; height: 12px; margin-top: 3px; overflow: visible; }\n.simple-mindmap span.mm-sym { display: inline-flex; align-items: center; justify-content: center; }\n.simple-mindmap span.mm-sym > * { max-width: 12px; max-height: 12px; }\n.simple-mindmap .mm-menu .mm-icon svg { width: 12px; height: 12px; vertical-align: -1px; overflow: visible; }\n@media (prefers-reduced-motion: no-preference) {\n  .simple-mindmap .mm-viewport.is-animating { transition: transform 180ms ease-out; }\n}\n";/*CSS-END*/

export const STRINGS = Object.freeze({
  ...DEFAULT_STRINGS,
  invalid: "Cannot draw the mindmap: the data is not valid",
  renderFailed: "Cannot draw the mindmap", renderFailedDetail: "{message}",
  errorLine: (e) => e.message,
  search: "Search ideas", searchLabel: "Search ideas by title or number",
  matches: "{index} / {total} matches", noMatches: "No matching ideas",
  prevMatch: "Previous match", nextMatch: "Next match",
  viewBoth: "Both sides", viewRight: "Tree to the right", viewOutline: "Outline", views: "Layout",
  allLinks: "All links",
  zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit", focusBranch: "Focus this branch", focusPath: "Focused branch",
  more: "More actions", expand: "Expand", collapse: "Collapse",
  rename: "Rename", addChild: "Add child", addSibling: "Add sibling", remove: "Delete", newIdea: "New idea",
});

function str(strings, key, vars) {
  const v = strings[key];
  if (typeof v === "function") return String(v(vars));
  return vars && typeof v === "string" ? fmt(v, vars) : String(v ?? key);
}

function fold(s) {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D").toLowerCase().trim();
}

function injectCSS(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  // First in <head>: the host's own stylesheets come later and win any tie.
  const at = doc.head || doc.documentElement;
  at.insertBefore(style, at.firstChild);
}

let uidSeq = 0;

export function createMindmap(el, opts = {}) {
  if (!el || !el.ownerDocument) throw new TypeError("createMindmap needs a DOM element");
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  injectCSS(doc);
  const uid = `mm${++uidSeq}`;
  const strings = { ...STRINGS, ...(opts.strings || {}) };
  // Each key merges with the default of the same key; an entry that sets an icon field replaces the inherited icon.
  const statuses = mergeStatuses(opts.statuses);
  const vopts = { statuses: Object.keys(statuses), limits: opts.limits };
  const mode = ["view", "select", "edit"].includes(opts.mode) ? opts.mode : "view";
  const actions = Array.isArray(opts.actions) ? opts.actions : [];
  const badgeFn = typeof opts.badge === "function" ? opts.badge : null;
  const listeners = new Map();

  // ---- state ----
  let data = null, idx = new Map(), errors = [], warnings = [];
  let view = VIEWS.includes(opts.view) ? opts.view : null;
  let selected = null, focusId = null, allLinks = false;
  const collapsed = new Set();
  const vp = { x: 0, y: 0, k: 1 };
  let vpSet = false, vpOwned = false; // vpOwned: the user (or a saved state) placed the viewport; resizing no longer refits
  let q = "", hits = [], hitIndex = -1;
  let filter = null, filterOnly = !!opts.filterOnly; // filter: null or a list of status keys; non-matching nodes are dimmed
  let lay = null, outlineRows = new Map(), outlineOrder = [];
  let destroyed = false;

  // ---- DOM ----
  const wrap = doc.createElement("div");
  wrap.className = "simple-mindmap";
  wrap.tabIndex = 0;
  wrap.dataset.mode = mode;
  // theme: "light" | "dark" | null, or {mode?, tokens: {name: css value}} (tokens become --mm-<name> on the root)
  let themeTokens = [], themeWarnings = [];
  function applyTheme(t) {
    let mode = null, tokens = null;
    if (t === null || t === undefined || typeof t === "string") mode = t ?? null;
    else if (isObj(t)) { mode = t.mode ?? null; tokens = t.tokens ?? null; }
    else return false;
    if (mode !== null && mode !== "light" && mode !== "dark") return false;
    if (tokens !== null && !isObj(tokens)) return false;
    for (const k of themeTokens) wrap.style.removeProperty(`--mm-${k}`);
    themeTokens = []; themeWarnings = [];
    if (mode) wrap.dataset.theme = mode; else delete wrap.dataset.theme;
    for (const [k, v] of Object.entries(tokens || {})) {
      if (!THEME_TOKENS.includes(k)) { themeWarnings.push({ path: `theme.tokens.${k}`, code: "unknown_key", message: `Unknown theme token "${k}" ignored` }); continue; }
      if (typeof v !== "string" || !v.trim() || /[\u0000-\u001F\u007F;{}]/.test(v)) {
        themeWarnings.push({ path: `theme.tokens.${k}`, code: "bad_value", message: `Theme token "${k}" must be a CSS value; ignored` }); continue;
      }
      wrap.style.setProperty(`--mm-${k}`, v.trim()); themeTokens.push(k);
    }
    return true;
  }
  applyTheme(opts.theme);
  el.appendChild(wrap);

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "mm-canvas");
  svg.setAttribute("role", "img");
  const vpG = doc.createElementNS(SVG_NS, "g"); vpG.setAttribute("class", "mm-viewport");
  const defsG = doc.createElementNS(SVG_NS, "defs");
  const edgesG = doc.createElementNS(SVG_NS, "g"); edgesG.setAttribute("class", "mm-edges");
  const linksG = doc.createElementNS(SVG_NS, "g"); linksG.setAttribute("class", "mm-links");
  const nodesG = doc.createElementNS(SVG_NS, "g"); nodesG.setAttribute("class", "mm-nodes");
  vpG.append(edgesG, linksG, nodesG);
  svg.append(defsG, vpG);
  svg.style.fontFamily = "var(--mm-font, var(--mmd-font))";

  const outlineEl = doc.createElement("div"); outlineEl.className = "mm-outline";
  const outlineHead = doc.createElement("div"); outlineHead.className = "mm-outline-head";
  const outlineBody = doc.createElement("div");
  outlineEl.append(outlineHead, outlineBody);

  const errorEl = doc.createElement("div"); errorEl.className = "mm-error"; errorEl.setAttribute("role", "alert");

  const button = (label, text, onClick, cls = "mm-btn") => {
    const b = doc.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = text; b.title = label; b.setAttribute("aria-label", label);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
    return b;
  };

  // search box (one element; moved between the map overlay and the outline head)
  const searchEl = doc.createElement("div"); searchEl.className = "mm-search"; searchEl.setAttribute("role", "search");
  const input = doc.createElement("input");
  input.type = "search"; input.placeholder = str(strings, "search"); input.setAttribute("aria-label", str(strings, "searchLabel"));
  const countEl = doc.createElement("span"); countEl.className = "mm-count"; countEl.setAttribute("aria-live", "polite");
  const prevBtn = button(str(strings, "prevMatch"), "\u2039", () => step(-1));
  const nextBtn = button(str(strings, "nextMatch"), "\u203A", () => step(1));
  searchEl.append(input, countEl, prevBtn, nextBtn);

  // tools
  const toolsEl = doc.createElement("div"); toolsEl.className = "mm-tools";
  const viewGroup = doc.createElement("div"); viewGroup.className = "mm-group"; viewGroup.setAttribute("role", "group"); viewGroup.setAttribute("aria-label", str(strings, "views"));
  const viewBtns = {
    both: button(str(strings, "viewBoth"), str(strings, "viewBoth"), () => setViewInt("both", true)),
    right: button(str(strings, "viewRight"), str(strings, "viewRight"), () => setViewInt("right", true)),
    outline: button(str(strings, "viewOutline"), str(strings, "viewOutline"), () => setViewInt("outline", true)),
  };
  viewGroup.append(viewBtns.both, viewBtns.right, viewBtns.outline);
  const linksBtn = button(str(strings, "allLinks"), str(strings, "allLinks"), () => { allLinks = !allLinks; render(); });
  toolsEl.append(viewGroup, linksBtn);
  const zoomEl = doc.createElement("div"); zoomEl.className = "mm-zoom";
  const focusBtn = button(str(strings, "focusBranch"), "\u25CE", () => { if (selected) { focusInt(selected); fitInt(true); } });
  zoomEl.append(
    button(str(strings, "zoomOut"), "\u2212", () => zoomBy(1 / 1.25, null, true)),
    button(str(strings, "zoomIn"), "+", () => zoomBy(1.25, null, true)),
    button(str(strings, "fit"), str(strings, "fit"), () => fitInt(true, true)),
    focusBtn,
  );
  const crumbsEl = doc.createElement("nav"); crumbsEl.className = "mm-crumbs"; crumbsEl.setAttribute("aria-label", str(strings, "focusPath"));
  const moreBtn = button(str(strings, "more"), "\u22EF", () => openMenu(), "mm-btn mm-more");
  let menuEl = null, renameEl = null;

  // ---- events ----
  let queued = []; // events raised while createMindmap() runs are delivered right after it returns
  function emit(name, payload) {
    if (queued) { queued.push([name, payload]); return; }
    for (const fn of [...(listeners.get(name) || [])]) {
      try { fn(payload); } catch (e) { (win || globalThis).setTimeout(() => { throw e; }); }
    }
  }

  // ---- measuring ----
  let ctx2d = null;
  const widths = new Map();
  function measure(text, kind) {
    const key = kind + "\u0000" + text;
    let w = widths.get(key);
    if (w !== undefined) return w;
    if (!ctx2d) {
      const c = doc.createElement("canvas");
      ctx2d = c.getContext && c.getContext("2d");
      if (!ctx2d) throw new Error("Text measuring is not available");
    }
    const size = FONT_SIZE[kind] || FONT_SIZE.node;
    ctx2d.font = `${kind === "root" ? "600 " : ""}${size}px ${kind === "num" ? MONO : FONT}`;
    w = ctx2d.measureText(text).width;
    if (widths.size > 20000) widths.clear();
    widths.set(key, w);
    return w;
  }

  function publicNode(n, id) {
    const out = { id };
    for (const k of ["title", "note", "status", "tone", "collapsed"]) if (n[k] !== undefined) out[k] = n[k];
    if (n.meta) out.meta = clone(n.meta);
    return out;
  }
  const badge = badgeFn ? (n, id) => { try { return badgeFn(publicNode(n, id)); } catch { return null; } } : null;

  // ---- data ----
  function initialCollapse() {
    collapsed.clear();
    let depth = Number.isInteger(opts.collapseDepth) ? opts.collapseDepth : null;
    if (depth === null && countNodes(data.root) > LARGE) depth = view === "outline" ? 3 : 2;
    for (const [id, e] of idx) {
      if (!e.node.children || !e.node.children.length) continue;
      if (e.node.collapsed || (depth !== null && e.depth >= depth)) collapsed.add(id);
    }
  }
  function prune(prevIds) {
    if (selected && !idx.has(selected)) selected = null;
    if (focusId && !idx.has(focusId)) focusId = null;
    for (const id of [...collapsed]) if (!idx.has(id)) collapsed.delete(id);
    if (prevIds) for (const [id, e] of idx) if (!prevIds.has(id) && e.node.collapsed && e.node.children) collapsed.add(id);
    if (q) { hits = findIds(q); hitIndex = hits.length ? Math.min(Math.max(hitIndex, 0), hits.length - 1) : -1; }
  }
  function useData(d) { data = d; idx = indexTree(data); }

  function ancestors(id) { const out = []; let e = idx.get(id); while (e && e.parentId) { out.push(e.parentId); e = idx.get(e.parentId); } return out; }
  function inFocus(id) { return !focusId || id === focusId || ancestors(id).includes(focusId); }

  // ---- search ----
  function findIds(text) {
    const f = fold(text);
    if (!f) return [];
    const out = [];
    for (const [id, e] of idx) if (e.num === text.trim() || fold(e.node.title).includes(f)) out.push(id);
    return out;
  }
  function runSearch(text, user) {
    q = String(text ?? "");
    if (input.value !== q) input.value = q;
    hits = findIds(q);
    hitIndex = hits.length ? 0 : -1;
    if (hitIndex >= 0) revealInt(hits[0], false);
    render();
    if (hitIndex >= 0) centerOn(hits[hitIndex], true);
    if (user) emit("search", { q, hits: [...hits] });
    return { hits: [...hits], index: hitIndex };
  }
  function step(d) {
    if (!hits.length) return { hits: [], index: -1 };
    hitIndex = (hitIndex + d + hits.length) % hits.length;
    revealInt(hits[hitIndex], false);
    render();
    centerOn(hits[hitIndex], true);
    return { hits: [...hits], index: hitIndex };
  }
  function updateCount() {
    countEl.textContent = !q.trim() ? "" : hits.length ? str(strings, "matches", { index: hitIndex + 1, total: hits.length }) : str(strings, "noMatches");
    prevBtn.disabled = nextBtn.disabled = hits.length < 2;
    prevBtn.hidden = nextBtn.hidden = !q.trim();
  }

  // ---- view state changes (internal; `user` decides whether an interaction event fires) ----
  function revealInt(id, doRender = true) {
    if (!idx.has(id)) return false;
    for (const a of ancestors(id)) collapsed.delete(a);
    if (!inFocus(id)) focusId = null;
    if (doRender) { render(); centerOn(id, true); }
    return true;
  }
  function toggleInt(id, user, want) {
    const e = idx.get(id);
    if (!e || !e.node.children || !e.node.children.length) return false;
    const next = want === undefined ? !collapsed.has(id) : want;
    if (next === collapsed.has(id)) return true;
    let moved = false;
    if (next) {
      collapsed.add(id);
      if (selected && ancestors(selected).includes(id)) { selected = id; moved = true; }
    } else collapsed.delete(id);
    render();
    if (user) emit("toggle", { id, collapsed: next });
    if (user && moved) emit("select", { id }); // the selection was inside the collapsed branch and moved to it
    return true;
  }
  function selectInt(id, user) {
    if (id !== null && !idx.has(id)) return false;
    if (selected === id && user) { if (id) emit("select", { id }); return true; } // a user click always reports, even unchanged
    selected = id;
    if (id) for (const a of ancestors(id)) collapsed.delete(a);
    render();
    if (id) ensureVisible(id);
    if (user && id) emit("select", { id });
    return true;
  }
  function focusInt(id) {
    if (id !== null && !idx.has(id)) return false;
    focusId = id && idx.get(id).parentId ? id : null;
    if (focusId) collapsed.delete(focusId);
    render();
    return true;
  }
  function setViewInt(kind, user) {
    if (!VIEWS.includes(kind)) return false;
    if (kind === view) return true;
    view = kind;
    render();
    if (kind !== "outline") fitInt(false);
    if (user) emit("view", { kind });
    return true;
  }

  // ---- viewport ----
  function size() { const r = wrap.getBoundingClientRect(); return { w: r.width || wrap.clientWidth || 800, h: r.height || wrap.clientHeight || 600 }; }
  let vpEmitQueued = false;
  function applyVp(animate, user) {
    if (user) vpOwned = true;
    vpG.classList.toggle("is-animating", !!animate);
    vpG.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.k})`;
    positionOverlays();
    if (user && !vpEmitQueued) {
      vpEmitQueued = true;
      const raf = (win && win.requestAnimationFrame) || ((f) => setTimeout(f, 16));
      raf(() => { vpEmitQueued = false; if (!destroyed) emit("viewport", { ...vp }); });
    }
  }
  function fitInt(animate, user) {
    if (!lay || view === "outline") return;
    const { w, h } = size();
    const b = lay.bounds, pad = 48;
    const k = Math.max(0.1, Math.min(1.25, (w - pad * 2) / Math.max(b.w, 1), (h - pad * 2) / Math.max(b.h, 1)));
    vp.k = k; vp.x = w / 2 - (b.x0 + b.w / 2) * k; vp.y = h / 2 - (b.y0 + b.h / 2) * k;
    vpSet = true;
    applyVp(animate, user);
  }
  function zoomBy(f, at, user) {
    const { w, h } = size();
    const p = at || { x: w / 2, y: h / 2 };
    const k = Math.max(0.1, Math.min(3, vp.k * f));
    vp.x = p.x - (p.x - vp.x) * (k / vp.k); vp.y = p.y - (p.y - vp.y) * (k / vp.k); vp.k = k;
    vpSet = true;
    applyVp(false, user);
  }
  function centerOn(id, animate) {
    if (view === "outline") { const r = outlineRows.get(id); if (r && r.scrollIntoView) r.scrollIntoView({ block: "center" }); return; }
    const b = lay && lay.boxes.get(id);
    if (!b) return;
    const { w, h } = size();
    vp.x = w / 2 - (b.x + b.w / 2) * vp.k; vp.y = h / 2 - (b.y + b.h / 2) * vp.k;
    vpSet = true;
    applyVp(animate, false);
  }
  function ensureVisible(id) {
    if (view === "outline") { const r = outlineRows.get(id); if (r && r.scrollIntoView) r.scrollIntoView({ block: "nearest" }); return; }
    const b = lay && lay.boxes.get(id);
    if (!b) return;
    const { w, h } = size();
    const sx = vp.x + b.x * vp.k, sy = vp.y + b.y * vp.k, sw = b.w * vp.k, sh = b.h * vp.k;
    if (sx < 0 || sy < 0 || sx + sw > w || sy + sh > h) centerOn(id, true);
  }

  // ---- status filter ----
  function checkFilter(list) {
    if (list === null || list === undefined) return { ok: true, value: null };
    if (!Array.isArray(list)) return { ok: false, errors: [{ path: "filter", code: "bad_status", message: "filter must be an array of statuses or null" }] };
    const errs = [];
    list.forEach((k, i) => { if (typeof k !== "string" || !statuses[k]) errs.push({ path: `filter[${i}]`, code: "bad_status", message: `Unknown status ${JSON.stringify(k)}` }); });
    return errs.length ? { ok: false, errors: errs } : { ok: true, value: [...new Set(list)] };
  }
  const matches = (e) => !!(filter && e.node.status && filter.includes(e.node.status));
  function dimSet() {
    if (!filter) return null;
    const out = new Set();
    for (const [id, e] of idx) if (!matches(e)) out.add(id);
    return out;
  }
  function keepSet() { // the matching nodes, their ancestors and the root
    const out = new Set([idx.keys().next().value]);
    for (const [id, e] of idx) if (matches(e)) { out.add(id); for (const a of ancestors(id)) out.add(a); }
    return out;
  }
  { const f = checkFilter(opts.filter); if (f.ok) filter = f.value; }

  // ---- rendering ----
  function showError(title, detail) {
    wrap.replaceChildren(errorEl);
    const t = doc.createElement("div"); t.className = "mm-error-title"; t.textContent = title;
    const d = doc.createElement("div"); d.className = "mm-error-detail"; d.textContent = detail || "";
    errorEl.replaceChildren(t, d);
  }
  // status render(): called once per status key per draw, copied per node; a throw or a non-Element -> the fallback
  // level and one `error` event for that key in that draw. Never called for the export.
  let drawRendered = new Map();
  function renderedEl(key) {
    if (drawRendered.has(key)) return drawRendered.get(key);
    const s = statuses[key]; let out = null;
    if (s && typeof s.render === "function") {
      try {
        const { render: fn, ...pub } = s;
        const got = fn(key, pub);
        if (!got || got.nodeType !== 1) throw new TypeError("render must return an Element");
        out = got;
      } catch (e) { emit("error", { message: `status ${JSON.stringify(key)}: ${String(e && e.message || e)}`, status: key }); }
    }
    drawRendered.set(key, out);
    return out;
  }
  const hooks = { rendered: (k) => !!renderedEl(k), render: (k) => { const e = renderedEl(k); return e ? e.cloneNode(true) : null; } };
  function render() {
    if (destroyed) return;
    drawRendered = new Map();
    closeMenu(); closeRename();
    if (!data) { showError(str(strings, "invalid"), errors[0] ? str(strings, "errorLine", errors[0]) : ""); return; }
    try {
      if (view === "outline") renderOutline(); else renderMap();
      updateTools();
      updateCount();
    } catch (e) {
      lay = null;
      showError(str(strings, "renderFailed"), str(strings, "renderFailedDetail", { message: String(e && e.message || e) }));
      emit("error", { message: String(e && e.message || e) });
    }
  }
  function mount(children) {
    const want = children.filter(Boolean);
    if (wrap.childNodes.length !== want.length || want.some((c, i) => wrap.childNodes[i] !== c)) wrap.replaceChildren(...want);
  }
  function renderMap() {
    const hitSet = new Set(hits);
    lay = layout(data, { view, collapsed, focus: focusId, measure, badge });
    const sc = scene(data, lay, {
      statuses, strings, selected, hits: hitSet, current: hits[hitIndex], links: allLinks ? "all" : "default",
      interactive: true, uid, dim: dimSet(), rendered: hooks.rendered,
    });
    defsG.replaceChildren(...sc.defs.map((s) => specToDom(doc, s)));
    edgesG.replaceChildren(...sc.edges.map((s) => specToDom(doc, s)));
    linksG.replaceChildren(...sc.links.map((s) => specToDom(doc, s)));
    nodesG.replaceChildren(...sc.nodes.map((s) => specToDom(doc, s, hooks)));
    if (data.title) svg.setAttribute("aria-label", data.title); else svg.removeAttribute("aria-label");
    renderCrumbs();
    const showMore = mode !== "view" && selected && lay.boxes.has(selected) && (mode === "edit" || actionsFor(selected).length);
    mount([svg, opts.search === false ? null : searchEl, opts.tools === false ? null : toolsEl, opts.tools === false ? null : zoomEl, focusId ? crumbsEl : null, showMore ? moreBtn : null]);
    applyVp(false, false);
  }
  function renderOutline() {
    lay = null;
    const built = buildOutline({ doc, idx, rootId: idx.keys().next().value, collapsed, selected, hits: new Set(hits), current: hits[hitIndex], statuses, strings, badge, dim: dimSet(), keep: filter && filterOnly ? keepSet() : null, hooks });
    outlineRows = built.rows; outlineOrder = built.order;
    outlineBody.replaceChildren(built.tree);
    outlineHead.replaceChildren(...[opts.search === false ? null : searchEl].filter(Boolean));
    const showMore = mode !== "view" && selected && outlineRows.has(selected) && (mode === "edit" || actionsFor(selected).length);
    mount([outlineEl, opts.tools === false ? null : toolsEl, showMore ? moreBtn : null]);
    positionOverlays();
  }
  function renderCrumbs() {
    if (!focusId) { crumbsEl.replaceChildren(); return; }
    const chain = [focusId, ...ancestors(focusId)].reverse();
    const parts = [];
    chain.forEach((id, i) => {
      if (i) { const s = doc.createElement("span"); s.textContent = "\u203A"; s.setAttribute("aria-hidden", "true"); parts.push(s); }
      const t = idx.get(id).node.title;
      const b = button(t, t, () => { focusInt(i === 0 ? null : id); fitInt(true, true); });
      if (id === focusId) b.setAttribute("aria-current", "true");
      parts.push(b);
    });
    crumbsEl.replaceChildren(...parts);
  }
  function updateTools() {
    for (const [k, b] of Object.entries(viewBtns)) b.setAttribute("aria-pressed", String(k === view));
    linksBtn.setAttribute("aria-pressed", String(allLinks));
    linksBtn.hidden = view === "outline" || !(data.links && data.links.length);
    focusBtn.disabled = !(selected && idx.get(selected) && idx.get(selected).parentId && selected !== focusId);
  }
  function positionOverlays() {
    if (!moreBtn.parentNode || !selected) return;
    const wr = wrap.getBoundingClientRect();
    let x, y;
    if (view === "outline") {
      const row = outlineRows.get(selected); if (!row) return;
      const r = row.getBoundingClientRect(); x = r.right - wr.left + 4; y = r.top - wr.top + (r.height - 22) / 2;
      x = Math.min(x, wr.width - 34);
    } else {
      const b = lay && lay.boxes.get(selected); if (!b) return;
      x = vp.x + (b.x + b.w) * vp.k + 10; y = vp.y + (b.y + b.h / 2) * vp.k - 11;
    }
    moreBtn.style.left = `${Math.round(x)}px`; moreBtn.style.top = `${Math.round(y)}px`;
  }

  // ---- menu, rename (select / edit modes) ----
  function actionsFor(id) {
    const e = idx.get(id); if (!e) return [];
    const pub = publicNode(e.node, id);
    return actions.filter((a) => { if (!a || !a.id) return false; if (typeof a.when !== "function") return true; try { return !!a.when(pub); } catch { return false; } });
  }
  function openMenu() {
    if (!selected) return;
    closeMenu();
    const id = selected; const e = idx.get(id);
    menuEl = doc.createElement("div"); menuEl.className = "mm-menu"; menuEl.setAttribute("role", "menu");
    const item = (label, fn, icon) => {
      const b = doc.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
      const ic = isObj(icon) ? sanitizeIcon(icon) : null;
      if (ic || (!isObj(icon) && icon !== undefined && icon !== null && icon !== "")) {
        const i = doc.createElement("span"); i.className = "mm-icon"; i.setAttribute("aria-hidden", "true");
        if (ic) {
          const sv = doc.createElementNS(SVG_NS, "svg"); sv.setAttribute("viewBox", "0 0 12 12");
          sv.appendChild(specToDom(doc, iconSpec(ic, { tok: "text" }, 6, 6)));
          i.appendChild(sv);
        } else i.textContent = String(icon);
        const t = doc.createElement("span"); t.textContent = label;
        b.append(i, t);
      } else b.textContent = label;
      b.addEventListener("click", (ev) => { ev.stopPropagation(); closeMenu(); fn(); }); menuEl.appendChild(b); return b;
    };
    for (const a of actionsFor(id)) item(String(a.label ?? a.id), () => emit("action", { action: a.id, id }), a.icon);
    if (mode === "edit") {
      item(str(strings, "rename"), () => startRename(id));
      item(str(strings, "addChild"), () => intentAddChild(id));
      if (e.parentId) item(str(strings, "addSibling"), () => intentAddSibling(id));
      if (e.parentId) item(str(strings, "remove"), () => intentRemove(id));
    }
    wrap.appendChild(menuEl);
    const x = parseFloat(moreBtn.style.left) || 0, y = (parseFloat(moreBtn.style.top) || 0) + 26;
    const W = size().w;
    menuEl.style.left = `${Math.max(4, Math.min(x, W - menuEl.offsetWidth - 4))}px`; menuEl.style.top = `${y}px`;
    const first = menuEl.querySelector("button"); if (first) first.focus();
  }
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function intentAddChild(id) { emit("intent", { op: "add", parent: id, node: { title: str(strings, "newIdea") } }); }
  function intentAddSibling(id) { const e = idx.get(id); if (e && e.parentId) emit("intent", { op: "add", parent: e.parentId, after: id, node: { title: str(strings, "newIdea") } }); }
  function intentRemove(id) { const e = idx.get(id); if (e && e.parentId) emit("intent", e.node.children && e.node.children.length ? { op: "remove", id, recursive: true } : { op: "remove", id }); }
  function startRename(id) {
    const e = idx.get(id); if (!e) return;
    closeRename();
    const inp = doc.createElement("input");
    inp.className = "mm-rename"; inp.value = e.node.title; inp.setAttribute("aria-label", str(strings, "rename"));
    const wr = wrap.getBoundingClientRect();
    let x = 8, y = 8, w = 200;
    if (view === "outline") { const r = outlineRows.get(id); if (r) { const rr = r.getBoundingClientRect(); x = rr.left - wr.left; y = rr.top - wr.top; w = rr.width; } }
    else { const b = lay && lay.boxes.get(id); if (b) { x = vp.x + b.x * vp.k; y = vp.y + b.y * vp.k; w = Math.max(160, b.w * vp.k); } }
    inp.style.left = `${Math.round(x)}px`; inp.style.top = `${Math.round(y)}px`; inp.style.width = `${Math.round(w)}px`;
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const t = inp.value.trim();
      closeRename();
      wrap.focus();
      if (commit && t && t !== e.node.title) emit("intent", { op: "edit", id, title: t });
    };
    inp.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    inp.addEventListener("blur", () => finish(true));
    renameEl = inp;
    wrap.appendChild(inp);
    inp.focus(); inp.select();
  }
  function closeRename() { if (renameEl) { const r = renameEl; renameEl = null; r.remove(); } }

  // ---- input handling ----
  const idFrom = (t) => { const g = t && t.closest ? t.closest("[data-id]") : null; return g && wrap.contains(g) ? g.getAttribute("data-id") : null; };
  const toggleFrom = (t) => { const g = t && t.closest ? t.closest("[data-toggle]") : null; return g && wrap.contains(g) ? g.getAttribute("data-toggle") : null; };
  let drag = null;

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const id = idFrom(e.target);
    drag = { sx: e.clientX, sy: e.clientY, x0: vp.x, y0: vp.y, id, toggle: toggleFrom(e.target), moved: false, kind: null, pid: e.pointerId };
    try { svg.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.kind = mode === "edit" && drag.id && !drag.toggle && idx.get(drag.id) && idx.get(drag.id).parentId ? "node" : "pan";
      if (drag.kind === "pan") svg.classList.add("is-panning");
      else { drag.g = nodesG.querySelector(`[data-id="${cssEscape(drag.id)}"]`); if (drag.g) { drag.g.classList.add("is-dragging"); drag.base = drag.g.getAttribute("transform"); } }
    }
    if (drag.kind === "pan") { vp.x = drag.x0 + dx; vp.y = drag.y0 + dy; vpSet = true; applyVp(false, true); }
    else if (drag.g) {
      drag.g.setAttribute("transform", `${drag.base} translate(${dx / vp.k},${dy / vp.k})`);
      const over = idFrom(doc.elementFromPoint(e.clientX, e.clientY));
      if (drag.over !== over) {
        if (drag.overG) drag.overG.classList.remove("is-drop");
        drag.over = over; drag.overG = null;
        if (over && canDrop(drag.id, over)) { drag.overG = nodesG.querySelector(`[data-id="${cssEscape(over)}"]`); if (drag.overG) drag.overG.classList.add("is-drop"); }
      }
    }
  }
  function canDrop(id, target) { const e = idx.get(id); return target !== id && !ancestors(target).includes(id) && e && e.parentId !== target; }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    svg.classList.remove("is-panning");
    if (d.moved) {
      if (d.kind === "node") {
        const target = d.over;
        render();
        if (target && canDrop(d.id, target)) emit("intent", { op: "move", id: d.id, parent: target });
      }
      return;
    }
    wrap.focus({ preventScroll: true });
    if (d.toggle) { toggleInt(d.toggle, true); return; }
    if (d.id && mode !== "view") clickNode(d.id);
  }
  let lastClick = null;
  function clickNode(id) {
    const now = Date.now();
    if (lastClick && lastClick.id === id && now - lastClick.t < 450) { lastClick = null; emit("open", { id }); return; }
    lastClick = { id, t: now };
    selectInt(id, true);
  }
  function onWheel(e) {
    if (view === "outline") return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.0025), { x: e.clientX - r.left, y: e.clientY - r.top }, true);
    else { vp.x -= e.deltaX; vp.y -= e.deltaY; vpSet = true; applyVp(false, true); }
  }
  function onOutlineClick(e) {
    const t = toggleFrom(e.target);
    if (t) { e.stopPropagation(); toggleInt(t, true); return; }
    const id = idFrom(e.target);
    if (id && mode !== "view") clickNode(id);
  }
  function navTarget(key) {
    const e = idx.get(selected); if (!e) return null;
    if (view === "outline") {
      const i = outlineOrder.indexOf(selected);
      if (key === "ArrowDown") return outlineOrder[i + 1] || null;
      if (key === "ArrowUp") return i > 0 ? outlineOrder[i - 1] : null;
      if (key === "ArrowRight") return e.node.children && !collapsed.has(selected) ? kidIds(selected)[0] : null;
      if (key === "ArrowLeft") return e.parentId;
      return null;
    }
    const b = lay && lay.boxes.get(selected); if (!b) return null;
    const side = b.side || 1;
    const out = key === "ArrowRight" ? side >= 0 : key === "ArrowLeft" ? side < 0 || b.root : false;
    if (key === "ArrowRight" || key === "ArrowLeft") {
      if (b.root) { const ks = kidIds(selected).filter((k) => lay.boxes.has(k)); return ks.find((k) => (lay.boxes.get(k).side || 1) === (key === "ArrowRight" ? 1 : -1)) || null; }
      if (out) return collapsed.has(selected) ? null : (kidIds(selected).find((k) => lay.boxes.has(k)) || null);
      return e.parentId && lay.boxes.has(e.parentId) ? e.parentId : null;
    }
    const sibs = e.parentId ? kidIds(e.parentId).filter((k) => lay.boxes.has(k) && (lay.boxes.get(k).side || 1) === side) : [];
    const i = sibs.indexOf(selected);
    if (key === "ArrowDown") return sibs[i + 1] || null;
    if (key === "ArrowUp") return i > 0 ? sibs[i - 1] : null;
    return null;
  }
  function kidIds(id) { const e = idx.get(id); return (e.node.children || []).map((c, i) => c.id || (e.num ? `${e.num}.${i + 1}` : String(i + 1))); }
  function onKeyDown(e) {
    if (e.target === input) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
      if (opts.search === false || !data) return;
      e.preventDefault(); input.focus(); input.select(); return;
    }
    if (menuEl && menuEl.contains(e.target)) {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); moreBtn.focus(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...menuEl.querySelectorAll("button")]; const i = items.indexOf(e.target);
        const n = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]; if (n) n.focus();
      }
      return;
    }
    if (e.target !== wrap || !data) return;
    if (e.key === "Escape") { closeMenu(); return; }
    if (mode === "view") return;
    if (!selected) {
      if (e.key.startsWith("Arrow")) { e.preventDefault(); selectInt(focusId || idx.keys().next().value, true); }
      return;
    }
    switch (e.key) {
      case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight": {
        e.preventDefault();
        const t = navTarget(e.key);
        if (t) selectInt(t, true);
        else if (e.key === (view === "outline" ? "ArrowRight" : "") && collapsed.has(selected)) toggleInt(selected, true, false);
        else if (view === "outline" && e.key === "ArrowLeft" && !collapsed.has(selected) && idx.get(selected).node.children) toggleInt(selected, true, true);
        return;
      }
      case "Enter": e.preventDefault(); emit("open", { id: selected }); return;
      case " ": e.preventDefault(); toggleInt(selected, true); return;
      case "ContextMenu": e.preventDefault(); if (moreBtn.parentNode) openMenu(); return;
    }
    if (mode !== "edit") return;
    const ent = idx.get(selected);
    if (e.key === "F2") { e.preventDefault(); startRename(selected); }
    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); intentAddChild(selected); }
    else if ((e.key === "Delete" || e.key === "Backspace") && ent.parentId) { e.preventDefault(); intentRemove(selected); }
  }
  function onSearchKey(e) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); if (input.value) runSearch("", true); else wrap.focus(); }
  }
  function onDocPointer(e) { if (menuEl && !menuEl.contains(e.target) && e.target !== moreBtn) closeMenu(); }

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  svg.addEventListener("wheel", onWheel, { passive: false });
  outlineEl.addEventListener("click", onOutlineClick);
  wrap.addEventListener("keydown", onKeyDown);
  input.addEventListener("keydown", onSearchKey);
  input.addEventListener("input", () => runSearch(input.value, true));
  doc.addEventListener("pointerdown", onDocPointer, true);
  let ro = null;
  if (win && win.ResizeObserver) {
    ro = new win.ResizeObserver(() => { if (!vpOwned && lay) fitInt(false); else positionOverlays(); });
    ro.observe(wrap);
  }

  // ---- first data ----
  const st = opts.state && typeof opts.state === "object" ? opts.state : null;
  function adoptState(s) {
    if (VIEWS.includes(s.view)) view = s.view;
    if (Array.isArray(s.collapsed)) { collapsed.clear(); for (const id of s.collapsed) if (idx.has(id)) collapsed.add(id); }
    if (s.selected && idx.has(s.selected)) selected = s.selected;
    if (s.focus && idx.has(s.focus)) focusId = idx.get(s.focus).parentId ? s.focus : null;
    if ("filter" in s) { const f = checkFilter(s.filter); if (f.ok) filter = f.value; }
    if (typeof s.filterOnly === "boolean") filterOnly = s.filterOnly;
    if (s.viewport && [s.viewport.x, s.viewport.y, s.viewport.k].every(Number.isFinite) && s.viewport.k > 0) { Object.assign(vp, { x: s.viewport.x, y: s.viewport.y, k: s.viewport.k }); vpSet = vpOwned = true; }
  }
  function firstDraw() {
    if (!view) view = VIEWS.includes(data.layout) ? data.layout : "both";
    initialCollapse();
    if (st) adoptState(st);
    if (st && typeof st.search === "string" && st.search) { q = st.search; input.value = q; hits = findIds(q); hitIndex = hits.length ? 0 : -1; }
    render();
    if (!vpSet) fitInt(false);
  }
  {
    const v = validate(opts.data, vopts);
    if (v.ok) { useData(v.data); warnings = v.warnings; firstDraw(); }
    else {
      errors = v.errors; if (!view) view = "both"; render();
      emit("invalid", { errors: clone(errors), source: "init" });
    }
    const early = queued; queued = null;
    if (early.length) Promise.resolve().then(() => { if (!destroyed) for (const [n, p] of early) emit(n, p); });
  }

  // ---- public API ----
  const api = {
    setData(json) {
      const v = validate(json, vopts);
      if (!v.ok) { errors = v.errors; emit("invalid", { errors: clone(errors), source: "setData" }); return { ok: false, errors: clone(errors) }; }
      const first = !data;
      const prevIds = first ? null : new Set(idx.keys());
      useData(v.data); errors = []; warnings = v.warnings;
      if (first) firstDraw(); else { prune(prevIds); render(); }
      return { ok: true, warnings: clone(warnings) };
    },
    apply(ops) {
      if (!data) {
        const errs = [{ path: "", code: "missing_root", message: "There is no valid data to apply operations to" }];
        errors = errs; emit("invalid", { errors: clone(errs), source: "apply", index: null });
        return { ok: false, errors: clone(errs) };
      }
      const r = applyOps(data, ops, vopts);
      if (!r.ok) { emit("invalid", { errors: clone(r.errors), source: "apply", index: r.index }); return { ok: false, errors: clone(r.errors), index: r.index }; }
      const prevIds = new Set(idx.keys());
      useData(r.data); warnings = r.warnings;
      prune(prevIds);
      for (const v of r.view) {
        if (!idx.has(v.id) && v.id !== null) continue;
        if (v.op === "collapse") { if (idx.get(v.id).node.children) collapsed.add(v.id); }
        else if (v.op === "expand") collapsed.delete(v.id);
        else if (v.op === "select") { selected = v.id; for (const a of ancestors(v.id)) collapsed.delete(a); }
        else if (v.op === "focus") focusId = v.id && idx.get(v.id).parentId ? v.id : null;
      }
      render();
      return { ok: true, warnings: clone(warnings) };
    },
    select(id) { return data ? selectInt(id ?? null, false) : false; },
    reveal(id) { return data ? revealInt(id) : false; },
    focus(id) { if (!data) return false; const ok = focusInt(id ?? null); if (ok) fitInt(true); return ok; },
    collapse(id) { return data ? toggleInt(id, false, true) : false; },
    expand(id) { return data ? toggleInt(id, false, false) : false; },
    setView(kind) { if (!VIEWS.includes(kind)) return false; if (!data) { view = kind; return true; } return setViewInt(kind, false); },
    fit() { fitInt(true, false); },
    focusSearch() {
      if (!data || opts.search === false || !input.isConnected) return false;
      input.focus(); input.select();
      return true;
    },
    setFilter(list) {
      const f = checkFilter(list);
      if (!f.ok) return { ok: false, errors: f.errors };
      filter = f.value;
      if (data) render();
      return { ok: true };
    },
    setFilterOnly(on) { filterOnly = !!on; if (data) render(); return { ok: true }; },
    search(text) { if (!data) { q = String(text ?? ""); return { hits: [], index: -1 }; } return runSearch(text, false); },
    next() { return step(1); },
    prev() { return step(-1); },
    getData() { return data ? clone(data) : null; },
    getNode(id) {
      const e = data && idx.get(id);
      if (!e) return null;
      return { id, path: e.num, parent: e.parentId, children: kidIds(id), node: publicNode(e.node, id) };
    },
    getPath(id) { const e = data && idx.get(id); return e ? e.num : null; },
    find(text) { return data ? findIds(String(text ?? "")) : []; },
    getState() {
      return { selected, collapsed: [...collapsed], focus: focusId, view, viewport: { ...vp }, search: q, filter: filter ? [...filter] : null, filterOnly };
    },
    export(format) {
      if (!data) return null;
      if (format === "json") return JSON.stringify(data, null, 2) + "\n";
      if (format === "outline") return toOutline(data);
      if (format === "mermaid") return toMermaid(data);
      if (format === "svg") {
        const cs = win && win.getComputedStyle ? win.getComputedStyle(wrap) : null;
        const theme = {};
        for (const t of TOKENS) { const v = cs && (cs.getPropertyValue(`--mm-${t}`).trim() || cs.getPropertyValue(`--mmd-${t}`).trim()); theme[t] = v || THEME[t]; }
        // A raw status colour (for example var(--brand)) is resolved by this page: computed colour of a probe element.
        const out = {};
        for (const [k, s] of Object.entries(statuses)) {
          if (s.color === undefined || s.color === null || TOKENS.includes(s.color)) { out[k] = s; continue; }
          const probe = doc.createElement("span"); probe.style.color = String(s.color); wrap.appendChild(probe);
          const got = win && win.getComputedStyle ? win.getComputedStyle(probe).color : ""; probe.remove();
          out[k] = { ...s, color: got || String(s.color) };
        }
        return toSVG(data, { view, collapsed, focus: view === "outline" ? null : focusId, measure, theme, statuses: out, strings, badge, links: allLinks ? "all" : "default", filter, limits: opts.limits });
      }
      return null;
    },
    get errors() { return clone(errors); },
    get warnings() { return clone([...warnings, ...themeWarnings]); },
    // setTheme("light" | "dark" | null | {mode?, tokens}) replaces the theme set so far; no redraw, no event.
    setTheme(t) { return destroyed ? false : applyTheme(t); },
    // setStatusStyle(key, {label?, color?, strike?, icon?, path?, image?, render?, symbol?, shape?}): restyle an existing
    // status (an icon field replaces the current icon); redraws keeping viewport, collapse and selection; no event.
    setStatusStyle(key, style) {
      if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(statuses, key)) {
        return { ok: false, errors: [{ path: "key", code: "bad_status", message: `Unknown status ${JSON.stringify(key)}` }] };
      }
      if (!isObj(style)) return { ok: false, errors: [{ path: "style", code: "bad_status", message: "style must be an object" }] };
      const pick = {};
      for (const k of STYLE_FIELDS) if (Object.prototype.hasOwnProperty.call(style, k)) pick[k] = style[k];
      statuses[key] = mergeStatus(statuses[key], pick);
      if (data && !destroyed) render();
      return { ok: true };
    },
    on(event, fn) {
      if (typeof fn !== "function") return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => { const s = listeners.get(event); if (s) s.delete(fn); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.removeEventListener("pointerdown", onDocPointer, true);
      if (ro) ro.disconnect();
      listeners.clear();
      wrap.remove();
    },
  };
  return api;
}

function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }
