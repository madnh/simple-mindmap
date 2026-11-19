// Layout: pure functions, no DOM. In: normalised data + a text-measuring function. Out: boxes and edges.
// "right": each subtree is a block, children stacked vertically, the parent centred on its children's block,
//          so two boxes never overlap. "both": the root's children are split into two halves balanced by
//          leaf count (order kept, right side first); the left half is the right tree mirrored.
// "outline": one row per visible node, indented by depth (used for SVG export of the outline view).
import { walk, clip } from "./model.js";

export const GEOM = Object.freeze({
  padX: 10, h: 28, hRoot: 40, vgap: 8, hgap: 40, rootGap: 12, sym: 12, gap: 6, maxChars: 48,
  chipPad: 6, indent: 22, rowGap: 4,
});

// measure(text, kind) -> width in px; kind is "root" | "node" | "num" | "small"
export function nodeBox(n, info, { measure, hidden = 0, badge = null, isRoot = false, full = false }) {
  const label = full ? n.title : clip(n.title, GEOM.maxChars);
  const parts = { label, num: isRoot ? "" : info.num };
  let w = GEOM.padX;
  if (!isRoot) w += GEOM.sym + GEOM.gap;
  parts.numX = w;
  if (parts.num) w += Math.ceil(measure(parts.num, "num")) + GEOM.gap;
  parts.labelX = w;
  parts.labelW = Math.ceil(measure(label, isRoot ? "root" : "node"));
  w += parts.labelW;
  if (badge && badge.symbol) { parts.badgeX = w + GEOM.gap; w += GEOM.gap + Math.ceil(measure(badge.symbol, "small")); }
  if (hidden) { const t = "+" + hidden; parts.chip = t; parts.chipX = w + GEOM.gap; parts.chipW = Math.ceil(measure(t, "small")) + GEOM.chipPad * 2; w += GEOM.gap + parts.chipW; }
  w += GEOM.padX;
  return { w, h: isRoot ? GEOM.hRoot : GEOM.h, ...parts };
}

function buildTree(data, collapsed, focus) {
  let top = null;
  const all = new Map();
  walk(data, (n, x) => {
    const t = { id: x.id, n, num: x.num, depth: x.depth, kids: [], parent: x.parent ? all.get(x.parent) : null, count: 1 };
    all.set(n, t);
    if (t.parent) t.parent.kids.push(t);
    if (x.id === focus) top = t;
  });
  const root = top || all.get(data.root);
  (function count(t) { for (const k of t.kids) t.count += count(k); return t.count; })(root);
  return { root, all };
}

const visKids = (t, collapsed) => (collapsed.has(t.id) ? [] : t.kids);

export function layout(data, opts = {}) {
  const view = opts.view === "right" || opts.view === "outline" ? opts.view : "both";
  const collapsed = opts.collapsed instanceof Set ? opts.collapsed : new Set(opts.collapsed || []);
  const measure = opts.measure;
  if (typeof measure !== "function") throw new TypeError("layout needs a measure(text, kind) function");
  const badge = typeof opts.badge === "function" ? opts.badge : null;
  const { root } = buildTree(data, collapsed, opts.focus);
  const boxes = new Map();
  const order = [];

  function box(t, branch, side) {
    const isRoot = t === root;
    const hidden = collapsed.has(t.id) ? t.count - 1 : 0;
    let b = null;
    if (badge) { try { b = badge(t.n, t.id); } catch { b = null; } }
    const bx = nodeBox(t.n, t, { measure, hidden, badge: b, isRoot, full: view === "outline" });
    const out = { id: t.id, depth: t.depth, branch, side, root: isRoot, hasKids: t.kids.length > 0, hidden, badge: b && b.symbol ? b : null, ...bx, x: 0, y: 0 };
    boxes.set(t.id, out); order.push(out);
    return out;
  }

  const edges = [];
  if (view === "outline") {
    let y = 0;
    (function rec(t, branch, level) {
      const b = box(t, branch, 1);
      b.x = level * GEOM.indent; b.y = y; y += b.h + GEOM.rowGap;
      visKids(t, collapsed).forEach((k, i) => { edges.push({ from: t.id, to: k.id, branch: branch ?? i }); rec(k, branch ?? i, level + 1); });
    })(root, null, 0);
  } else {
    // sizes (post-order): sub = height of the subtree block
    const sub = new Map();
    function size(t, branch, side) {
      const b = box(t, branch, side);
      const ks = visKids(t, collapsed);
      let ch = 0;
      ks.forEach((k, i) => { ch += size(k, branch ?? i, side); });
      ch += Math.max(0, ks.length - 1) * GEOM.vgap;
      sub.set(t.id, { h: Math.max(b.h, ch), ch });
      return sub.get(t.id).h;
    }
    function place(t, x, top, dir) {
      const b = boxes.get(t.id), s = sub.get(t.id);
      b.x = dir > 0 ? x : x - b.w;
      b.y = top + s.h / 2 - b.h / 2;
      let cy = top + (s.h - s.ch) / 2;
      const nx = dir > 0 ? b.x + b.w + GEOM.hgap : b.x - GEOM.hgap;
      for (const k of visKids(t, collapsed)) {
        edges.push({ from: t.id, to: k.id, branch: boxes.get(k.id).branch });
        place(k, nx, cy, dir); cy += sub.get(k.id).h + GEOM.vgap;
      }
    }
    const ks = visKids(root, collapsed);
    if (view === "right") {
      size(root, null, 1);
      place(root, 0, 0, 1);
    } else {
      const rb = box(root, null, 0);
      const leaves = (t) => { const k = visKids(t, collapsed); return k.length ? k.reduce((s, c) => s + leaves(c), 0) : 1; };
      const total = ks.reduce((s, c) => s + leaves(c), 0);
      const right = [], left = [];
      let acc = 0;
      ks.forEach((k, i) => {
        const l = leaves(k);
        // keep order: fill the right side until it holds half the leaves, then the rest goes left
        if (!left.length && (right.length === 0 || acc + l / 2 <= total / 2)) { right.push([k, i]); acc += l; } else left.push([k, i]);
      });
      rb.x = -rb.w / 2; rb.y = -rb.h / 2;
      for (const [list, dir] of [[right, 1], [left, -1]]) {
        let hsum = 0;
        for (const [k, i] of list) { hsum += size(k, i, dir); }
        hsum += Math.max(0, list.length - 1) * GEOM.vgap * 2;
        let y = -hsum / 2;
        const x = dir > 0 ? rb.w / 2 + GEOM.hgap + GEOM.rootGap : -rb.w / 2 - GEOM.hgap - GEOM.rootGap;
        for (const [k] of list) {
          edges.push({ from: root.id, to: k.id, branch: boxes.get(k.id).branch });
          place(k, x, y, dir); y += sub.get(k.id).h + GEOM.vgap * 2;
        }
      }
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of order) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { view, rootId: root.id, boxes, order, edges, bounds: { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } };
}

// Counts pairs of boxes that overlap (touching edges do not count).
export function overlaps(boxes) {
  const a = [...(boxes instanceof Map ? boxes.values() : boxes)].sort((p, q) => p.x - q.x);
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    for (let j = i + 1; j < a.length && a[j].x < p.x + p.w; j++) {
      const q = a[j];
      if (p.y < q.y + q.h && q.y < p.y + p.h) n++;
    }
  }
  return n;
}
