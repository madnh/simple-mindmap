// Writes the 1.0 sample data set (test/fixtures/v1). Run ONCE for 1.0; the files are then frozen:
// every 1.x release must accept all of them unchanged (validation may only loosen within 1.x).
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomTree } from "../helpers.mjs";

const dir = fileURLToPath(new URL("../fixtures/v1/", import.meta.url));
const put = (name, obj) => {
  const p = dir + name;
  if (existsSync(p) && !process.argv.includes("--force")) { console.log("kept", name); return; }
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); console.log("wrote", name);
};

put("architecture.json", {
  mindmap: 1, title: "Notification architecture", layout: "both",
  root: {
    id: "root", title: "Notifications", note: "Short **Markdown** note.\n\n- kept verbatim\n- including\ttabs",
    children: [
      { id: "pane", title: "Pane notifications", status: "decided", children: [
        { id: "pane-badge", title: "Badge on the tab" },
        { id: "pane-sound", title: "Sound", status: "parked" },
      ] },
      { id: "plugin", title: "Plugin notifications", tone: "amber", collapsed: true, children: [
        { title: "Permission prompt", status: "pending" },
        { title: "Rate limit", status: "blocked", meta: { by: "agent", at: "2026-11-19T10:00:00Z" } },
      ] },
      { id: "history", title: "History", status: "open", children: [{ title: "Old inbox", status: "superseded" }] },
      { title: "Settings", tone: "blue" },
    ],
  },
  links: [
    { from: "plugin", to: "pane", type: "relates", label: "shared profile" },
    { from: "history", to: "pane-badge", type: "blocks" },
    { from: "pane-sound", to: "history", type: "supersedes" },
  ],
});

put("statuses-tones.json", {
  title: "Every status and tone",
  root: { title: "Legend", children: [
    ...["open", "pending", "decided", "parked", "blocked", "superseded"].map((s) => ({ id: `s-${s}`, title: s, status: s })),
    ...["green", "amber", "red", "blue", "purple", "grey"].map((t) => ({ id: `t-${t}`, title: t, tone: t })),
  ] },
});

put("text.json", {
  mindmap: 1, title: "Text handling", layout: "right",
  root: { id: "text", title: "Chữ tiếng Việt có dấu — đ Đ", children: [
    { id: "html", title: "<img src=x onerror=alert(1)> & \"quotes\" 'single'" },
    { id: "emoji", title: "Emoji 👩‍👩‍👧‍👦 🇻🇳 flags and ZWJ" },
    { id: "cjk", title: "中文 日本語 한국어" },
    { id: "rtl", title: "עברית العربية" },
    { id: "ctrl", title: "Control\u0007chars\u0000stripped" },
    { id: "nfd", title: "Café (NFD input)" },
    { id: "long", title: "A long title that goes on and on past the forty-eight grapheme clip on the map" },
  ] },
  links: [{ from: "html", to: "emoji", label: "<b>not bold</b>" }],
});

const deep = { id: "d1", title: "Level 1" };
let cur = deep;
for (let i = 2; i <= 16; i++) { const n = { id: `d${i}`, title: `Level ${i}` }; cur.children = [n]; cur = n; }
put("limits.json", {
  title: "T".repeat(200),
  root: { id: "lim", title: "x".repeat(200), note: "n".repeat(16384), meta: { blob: "m".repeat(4096 - 11) }, children: [
    deep.children[0],
    { id: "a-b_C-9", title: "Id with every allowed character class" },
    { id: "z".repeat(64), title: "Id of 64 characters" },
  ] },
  links: [{ from: "lim", to: "a-b_C-9", label: "L".repeat(60) }],
});

put("minimal.json", { root: { title: "Only a root" } });

put("large-2000.json", { mindmap: 1, title: "Generated 2000 nodes", root: randomTree(2000, 7) });
