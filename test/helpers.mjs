// Shared test helpers (node and browser runners).
// A deterministic pseudo-random generator (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = ["alpha", "branch", "cache", "delta", "event", "folder", "gate", "hook", "index", "join", "kernel", "layout", "merge", "node", "option", "plugin", "queue", "render", "store", "token", "update", "view", "watch"];
const STATUSES = ["open", "pending", "decided", "parked", "blocked", "superseded"];
// randomTree(n, seed, {maxDepth}) → a root node with exactly n nodes, deterministic for a seed.
export function randomTree(n, seed, { maxDepth = 8 } = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const title = () => { const k = 1 + Math.floor(r() * 5); return Array.from({ length: k }, () => pick(WORDS)).join(" "); };
  const root = { id: "n0", title: "Root " + title() };
  const all = [{ node: root, depth: 1 }];
  for (let i = 1; i < n; i++) {
    let p;
    do { p = all[Math.floor(Math.pow(r(), 0.7) * all.length)]; } while (p.depth >= maxDepth);
    const node = { id: `n${i}`, title: title() };
    if (r() < 0.3) node.status = pick(STATUSES);
    (p.node.children || (p.node.children = [])).push(node);
    all.push({ node, depth: p.depth + 1 });
  }
  return root;
}
