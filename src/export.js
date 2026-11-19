// Text formats: Markdown outline (to and from) and Mermaid mindmap. Pure, no DOM.
import { validate } from "./model.js";

const BULLET = /^([-*+])(\s+)/;
const asData = (json) => { const v = validate(json); return v.ok ? v.data : null; };

// toOutline(json) -> Markdown: "# title", then nested "- title" bullets (2 spaces per level),
// notes as indented lines under their bullet. A note line that would read as a bullet is escaped ("\- ").
export function toOutline(json) {
  const data = asData(json);
  if (!data) return null;
  const out = [];
  if (data.title) out.push(`# ${data.title}`, "");
  (function rec(n, depth) {
    const pad = "  ".repeat(depth);
    out.push(`${pad}- ${n.title}`);
    if (n.note) {
      for (const line of n.note.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n")) {
        if (!line.trim()) { out.push(""); continue; }
        const body = line.replace(/^\s*/, (ws) => ws.replace(/\t/g, "    "));
        // A note line that looks like a bullet, or already starts with a backslash, gets one more backslash in front.
        const t = body.trimStart();
        out.push(`${pad}  ${BULLET.test(t) || t.startsWith("\\") ? body.replace(/^(\s*)/, "$1\\") : body}`);
      }
    }
    for (const c of n.children || []) rec(c, depth + 1);
  })(data.root, 0);
  return out.join("\n") + "\n";
}

// fromOutline(md, {rootTitle}) -> JSON section 2.1 (not validated; pass it to validate()).
// One top-level bullet becomes the root; several become children of a root named after the "# heading"
// (or opts.rootTitle). Indented non-bullet lines under a bullet are its note.
export function fromOutline(md, opts = {}) {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  let title;
  const tops = [];
  const stack = []; // {indent, node, noteLines, blank}
  let last = null;
  const flush = (e) => {
    if (!e || !e.noteLines.length) return;
    while (e.noteLines.length && !e.noteLines[e.noteLines.length - 1].trim()) e.noteLines.pop();
    if (e.noteLines.length) {
      const kids = e.node.children;
      delete e.node.children;
      e.node.note = e.noteLines.join("\n");
      if (kids) e.node.children = kids;
    }
  };
  const all = [];
  for (const raw of lines) {
    const line = raw.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, "    "));
    const indent = line.length - line.trimStart().length;
    const body = line.trimStart();
    if (!body) { if (last) last.noteLines.push(""); continue; }
    const m = BULLET.exec(body);
    if (m) {
      const node = { title: body.slice(m[0].length).trim() };
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) (parent.node.children || (parent.node.children = [])).push(node); else tops.push(node);
      last = { indent, node, noteLines: [] };
      all.push(last);
      stack.push(last);
      continue;
    }
    if (!last && title === undefined && /^#\s+/.test(body)) { title = body.replace(/^#\s+/, "").trim(); continue; }
    if (last && indent > last.indent) {
      const cut = Math.min(indent, last.indent + 2);
      let text = line.slice(cut);
      text = text.replace(/^(\s*)\\(?=\\|[-*+]\s)/, "$1");
      last.noteLines.push(text);
    }
  }
  for (const e of all) flush(e);
  const out = { mindmap: 1 };
  if (title !== undefined) out.title = title;
  if (tops.length === 1) out.root = tops[0];
  else if (tops.length > 1) out.root = { title: title || opts.rootTitle || "Mindmap", children: tops };
  return out;
}

// toMermaid(json) -> a Mermaid `mindmap` block body (no fences). Links are dropped; a status becomes a
// `:::status-<key>` class line under its node.
export function toMermaid(json) {
  const data = asData(json);
  if (!data) return null;
  const q = (s) => s.replace(/"/g, "#quot;");
  const out = ["mindmap"];
  let k = 0;
  (function rec(n, depth) {
    const pad = "  ".repeat(depth + 1);
    const id = depth === 0 ? "root" : `n${k}`;
    k++;
    out.push(depth === 0 ? `${pad}${id}(("${q(n.title)}"))` : `${pad}${id}["${q(n.title)}"]`);
    if (n.status) out.push(`${pad}:::status-${n.status}`);
    for (const c of n.children || []) rec(c, depth + 1);
  })(data.root, 0);
  return out.join("\n") + "\n";
}
