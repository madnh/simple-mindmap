// Outline view: the tree as nested rows. DOM only through createElement / textContent.
import { statusShape, statusLevel, isStrike, symbolRegistry } from "./svg.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Builds an SVG element from a scene spec; paint tokens become CSS variables. hooks.render(key) returns a fresh copy of
// the element a status render() gave (a spec with `rk` is the slot for it).
export function specToDom(doc, spec, hooks) {
  const node = doc.createElementNS(SVG_NS, spec.t);
  for (const [k, v] of Object.entries(spec.a || {})) if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  for (const [k, v] of Object.entries(spec.p || {})) node.style.setProperty(k, v.tok ? `var(--mm-${v.tok}, var(--mmd-${v.tok}))` : v.raw);
  if (spec.c) node.setAttribute("class", spec.c);
  if (spec.x !== undefined) node.textContent = spec.x;
  if (spec.rk !== undefined && hooks && hooks.render) {
    const got = hooks.render(spec.rk);
    if (got) {
      if (got.namespaceURI === SVG_NS) node.appendChild(got);
      else {
        const fo = doc.createElementNS(SVG_NS, "foreignObject");
        fo.setAttribute("width", "12"); fo.setAttribute("height", "12");
        fo.appendChild(got);
        node.appendChild(fo);
      }
    }
  }
  for (const c of spec.k || []) node.appendChild(specToDom(doc, c, hooks));
  return node;
}

// The row symbol: same levels as the map. render -> a span holding a copy of the element; icon and image -> a <use>
// of the outline's shared <symbol> (symbols: the registry); shapes, symbols and dots inline.
function symbol(doc, n, statuses, hooks, symbols) {
  if (n.status && statuses[n.status]) {
    const lv = statusLevel(n.status, statuses, { rendered: hooks && hooks.rendered });
    if (lv.level === "render") {
      const span = doc.createElement("span");
      span.className = "mm-sym mm-sym-render"; span.setAttribute("aria-hidden", "true");
      const got = hooks.render(n.status);
      if (got) span.appendChild(got);
      return span;
    }
  }
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "mm-sym");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("aria-hidden", "true");
  if (n.status) { const s = statusShape(n.status, statuses, 6, 6, { symbols }); if (s) svg.appendChild(specToDom(doc, s)); }
  else if (n.tone) svg.appendChild(specToDom(doc, { t: "circle", a: { cx: 6, cy: 6, r: 4 }, p: { fill: { tok: n.tone } } }));
  return svg;
}

// ctx: {doc, data, idx, rootId, collapsed, selected, hits, current, statuses, strings, badge, dim, keep, hooks, uid}
// -> {tree, rows, order, defs}: defs is one hidden <svg> holding the <symbol>s the rows reference.
export function buildOutline(ctx) {
  const { doc, idx, collapsed, statuses } = ctx;
  const symbols = symbolRegistry(`${ctx.uid || "mm"}-os`);
  const tree = doc.createElement("ul");
  tree.className = "mm-tree";
  tree.setAttribute("role", "tree");
  const rows = new Map();
  const order = [];
  (function rec(id, parentEl, level) {
    const e = idx.get(id); const n = e.node;
    const li = doc.createElement("li");
    li.setAttribute("role", "treeitem");
    li.setAttribute("aria-level", String(level));
    li.dataset.id = id;
    const all = (n.children || []).map((c, i) => c.id || (e.num ? `${e.num}.${i + 1}` : String(i + 1)));
    const kids = ctx.keep ? all.filter((k) => ctx.keep.has(k)) : all; // filterOnly hides branches without a match
    const open = kids.length > 0 && !collapsed.has(id);
    if (kids.length) li.setAttribute("aria-expanded", String(open));
    const row = doc.createElement("div");
    const cls = ["mm-row"];
    if (!e.parentId) cls.push("is-root");
    if (ctx.selected === id) { cls.push("is-selected"); li.setAttribute("aria-selected", "true"); }
    if (ctx.hits && ctx.hits.has(id)) cls.push("is-hit");
    if (ctx.current === id) cls.push("is-current");
    if (ctx.dim && ctx.dim.has(id)) cls.push("is-dim");
    if (n.status && isStrike(statuses[n.status])) cls.push("is-superseded");
    row.className = cls.join(" ");
    if (kids.length) {
      const arrow = doc.createElement("button");
      arrow.type = "button"; arrow.className = "mm-arrow"; arrow.tabIndex = -1;
      arrow.dataset.toggle = id;
      arrow.setAttribute("aria-expanded", String(open));
      arrow.setAttribute("aria-label", open ? ctx.strings.collapse : ctx.strings.expand);
      arrow.textContent = "\u25B8";
      row.appendChild(arrow);
    } else {
      const pad = doc.createElement("span"); pad.className = "mm-arrow-pad"; row.appendChild(pad);
    }
    if (e.parentId) row.appendChild(symbol(doc, n, statuses, ctx.hooks, symbols));
    if (e.num) { const num = doc.createElement("span"); num.className = "mm-num"; num.textContent = e.num; row.appendChild(num); }
    const title = doc.createElement("span"); title.className = "mm-title"; title.textContent = n.title; row.appendChild(title);
    if (n.status && statuses[n.status] && statuses[n.status].label) row.title = statuses[n.status].label;
    const b = ctx.badge ? ctx.badge(n, id) : null;
    if (b && b.symbol) {
      const s = doc.createElement("span"); s.className = "mm-badge"; s.textContent = String(b.symbol);
      if (b.label) s.title = String(b.label);
      row.appendChild(s);
    }
    li.appendChild(row);
    parentEl.appendChild(li);
    rows.set(id, row); order.push(id);
    if (open) {
      const ul = doc.createElement("ul"); ul.setAttribute("role", "group");
      li.appendChild(ul);
      for (const k of kids) rec(k, ul, level + 1);
    }
  })(ctx.rootId, tree, 1);
  const defs = doc.createElementNS(SVG_NS, "svg");
  defs.setAttribute("class", "mm-defs"); defs.setAttribute("aria-hidden", "true"); defs.setAttribute("width", "0"); defs.setAttribute("height", "0");
  const d = doc.createElementNS(SVG_NS, "defs");
  for (const sp of symbols.defs) d.appendChild(specToDom(doc, sp));
  defs.appendChild(d);
  return { tree, rows, order, defs };
}

