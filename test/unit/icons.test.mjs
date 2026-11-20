// Status icons (1.1): levels and precedence, the replace rule for host entries, strike, export colours, the icon
// whitelist and caps, the image URL filter, statusIcon. Pure: node only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  statusLevel, statusIcon, sanitizeIcon, imageUrl, mergeStatuses, isStrike, toSVG, fakeMeasure, DEFAULT_STATUSES, THEME, ICON_LIMITS,
} from "../../src/svg.js";

const CHECK = [["path", { d: "M20 6 9 17l-5-5" }]];
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const data = (status) => ({ root: { id: "r", title: "Root", children: [{ id: "a", title: "Alpha", status }] } });
const svgOf = (statuses, status = "x") => toSVG(data(status), { statuses, measure: fakeMeasure });
const count = (s, needle) => s.split(needle).length - 1;

test("status icons: precedence render > image > icon > shape > symbol > dot; the export skips render and non-data: images", () => {
  const full = { render: () => null, image: PNG, icon: { nodes: CHECK }, shape: "open", symbol: "*" };
  const lv = (s, o) => statusLevel("x", { x: s }, o).level;
  const yes = () => true;
  assert.equal(lv(full, { rendered: yes }), "render");
  assert.equal(lv(full), "image"); // no rendered element held: next level
  assert.equal(lv(full, { export: true, rendered: yes }), "image"); // render never in the export
  assert.equal(lv({ ...full, image: "https://example.test/a.png" }, { export: true }), "icon");
  assert.equal(lv({ ...full, image: "https://example.test/a.png" }, { rendered: () => false }), "image");
  const { render, image, ...noImg } = full;
  assert.equal(lv(noImg), "icon");
  assert.equal(lv({ ...noImg, icon: undefined, path: "M1 1L11 11" }), "icon"); // path is sugar for icon
  assert.equal(lv({ shape: "open", symbol: "*" }), "shape");
  assert.equal(lv({ shape: "nonsense", symbol: "*" }), "symbol");
  assert.equal(lv({}), "dot");
  assert.equal(statusLevel("missing", { x: {} }), null);
  // in the file: the data: image is embedded, an https image falls back to the icon
  const a = svgOf({ x: { label: "X", ...full } });
  assert.equal(count(a, "<image"), 1);
  assert.ok(a.includes(`href="${PNG}"`));
  const b = svgOf({ x: { label: "X", ...full, image: "https://example.test/a.png" } });
  assert.equal(count(b, "<image"), 0);
  assert.ok(b.includes('d="M20 6 9 17l-5-5"'));
});

test("M1: a host symbol on a default status key shows (inherited icon fields are dropped; label, color, strike inherit)", () => {
  const st = mergeStatuses({ decided: { symbol: "*" }, superseded: { icon: { nodes: CHECK } }, done: { label: "Done" } });
  assert.deepEqual(st.decided, { label: "Decided", color: "green", symbol: "*" });
  assert.equal(statusLevel("decided", st).level, "symbol");
  assert.equal(st.superseded.strike, true);
  assert.equal(st.superseded.shape, undefined);
  assert.deepEqual(st.done, { label: "Done" });
  // an entry without an icon field keeps the inherited icon
  assert.equal(mergeStatuses({ decided: { color: "red" } }).decided.shape, "decided");
  const s = statusIcon("decided", { decided: { symbol: "*" } });
  assert.ok(s.includes(">*</text>"), s);
  assert.ok(s.includes(`fill="${THEME.green}"`));
});

test("strike: true strikes and fades the title; superseded keeps it with a custom icon", () => {
  assert.equal(isStrike({ strike: true }), true);
  assert.equal(isStrike({ shape: "superseded" }), true);
  assert.equal(isStrike({ shape: "open" }), false);
  assert.equal(DEFAULT_STATUSES.superseded.strike, true);
  const fades = (svg) => count(svg, 'opacity="0.55"');
  assert.equal(fades(svgOf({ x: { label: "Dropped", symbol: "x", strike: true } })), 2); // label + strike line
  assert.equal(fades(svgOf({ x: { label: "Kept", symbol: "x" } })), 0);
  assert.equal(fades(svgOf(mergeStatuses({ superseded: { icon: { nodes: CHECK } } }), "superseded")), 2);
});

test("export: a raw var() status colour never reaches the SVG (pure toSVG uses grey)", () => {
  const s = svgOf({ x: { label: "X", color: "var(--brand)", icon: { nodes: CHECK, stroke: true } } });
  assert.equal(count(s, "var("), 0);
  assert.ok(s.includes(`stroke="${THEME.grey}"`));
  assert.equal(count(statusIcon("x", { x: { color: "var(--brand)" } }), "var("), 0);
  // a concrete raw colour is kept
  assert.ok(svgOf({ x: { label: "X", color: "#123456" } }).includes('fill="#123456"'));
});

test("icon whitelist: href, on*, style, unknown tags (also nested) and url() fills are dropped; an over-cap icon falls back", () => {
  const ic = sanitizeIcon({ nodes: [
    ["path", { d: "M1 1L5 5", onclick: "x()", style: "fill:red", href: "#a", "xlink:href": "#b", fill: "url(#g)", transform: "scale(9)" }],
    ["script", { src: "x.js" }],
    ["image", { href: "https://example.test/x.png" }],
    ["g", { id: "z" }, [["foreignObject", {}], ["circle", { cx: 6, cy: "6", r: ".5", fill: "currentColor", onload: "x()" }], ["use", { href: "#q" }]]],
    ["rect", { x: "1e3", y: "javascript:1", width: "2", height: Infinity }],
  ] });
  assert.ok(ic);
  assert.deepEqual(ic.nodes.map((n) => n.t), ["path", "g", "rect"]);
  assert.deepEqual(ic.nodes[0].a, { d: "M1 1L5 5" });
  assert.deepEqual(ic.nodes[1].a, {});
  assert.deepEqual(ic.nodes[1].k.map((n) => [n.t, n.a, n.fills]), [["circle", { cx: "6", cy: "6", r: ".5" }, ["fill"]]]);
  assert.deepEqual(ic.nodes[2].a, { x: "1e3", width: "2" });
  const out = statusIcon("x", { x: { color: "red", icon: { nodes: [["path", { d: "M1 1", onclick: "x()" }], ["script", {}]] } } });
  for (const bad of ["onclick", "script", "style=", "href", "url("]) assert.equal(count(out, bad), 0, bad);
  // caps: more than 64 nodes, or a d longer than 8 KiB -> null (the fallback level draws)
  const many = Array.from({ length: ICON_LIMITS.nodes + 1 }, () => ["circle", { r: 1 }]);
  assert.equal(sanitizeIcon({ nodes: many }), null);
  assert.ok(sanitizeIcon({ nodes: many.slice(1) }));
  assert.equal(sanitizeIcon({ nodes: [["g", {}, many]] }), null); // nested nodes count too
  assert.equal(sanitizeIcon({ nodes: [["path", { d: "M" + "1 ".repeat(ICON_LIMITS.d) }]] }), null);
  assert.equal(statusLevel("x", { x: { icon: { nodes: many }, symbol: "*" } }).level, "symbol");
  // nothing usable left, a bad viewBox, or not an object: null
  assert.equal(sanitizeIcon({ nodes: [["script", {}]] }), null);
  assert.equal(sanitizeIcon({ viewBox: "0 0 24", nodes: CHECK }), null);
  assert.equal(sanitizeIcon("M1 1"), null);
  assert.equal(sanitizeIcon({ viewBox: "0 0 12 12", nodes: CHECK }).viewBox, "0 0 12 12");
});

test("image: scheme filter; the export embeds data: only (0 external hrefs)", () => {
  for (const ok of [PNG, "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", "data:image/webp;base64,AA", "https://example.test/i.png",
    "http://example.test/i.png", "blob:https://example.test/1", "icons/done.png", "/icons/done.png"]) assert.equal(imageUrl(ok), ok, ok);
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "java\tscript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x</b>",
    "data:image/x-icon;base64,AA", "vbscript:x", "ftp://example.test/i.png", "", "  ", "a b.png", 42, null]) assert.equal(imageUrl(bad), null, String(bad));
  for (const url of ["https://example.test/i.png", "//example.test/i.png", "http://example.test/i.png", "blob:https://example.test/1"]) {
    const s = svgOf({ x: { label: "X", image: url, symbol: "*" } });
    assert.equal(count(s, "<image"), 0, url);
    assert.equal(count(s, 'href="http') + count(s, 'href="//') + count(s, 'href="blob'), 0, url);
    assert.ok(s.includes(">*</text>"), url);
  }
  assert.equal(count(svgOf({ x: { label: "X", image: "javascript:alert(1)" } }), "javascript"), 0);
  assert.equal(count(svgOf({ x: { label: "X", image: PNG } }), "<image"), 1);
});

test("A1: the export defines each icon once as <symbol id=mm-s-N> and every node draws a <use href=#...>", () => {
  const st = { secretkey: { label: "S", icon: { nodes: CHECK, stroke: true } }, other: { label: "O", image: PNG }, plain: { label: "P", shape: "open" } };
  const d = { root: { id: "r", title: "R", children: [1, 2, 3, 4, 5, 6].map((i) => ({ id: "n" + i, title: "N" + i, status: i < 4 ? "secretkey" : i < 6 ? "other" : "plain" })) } };
  const s = toSVG(d, { statuses: st, measure: fakeMeasure });
  assert.equal(count(s, "<symbol"), 2);
  assert.deepEqual([...s.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]), ["mm-s-0", "mm-s-1"]);
  assert.equal(count(s, "<use "), 5);
  assert.equal(count(s, "<svg"), 1, "no nested svg per node");
  const hrefs = [...s.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.every((h) => h.startsWith("#") || h === PNG), hrefs.join());
  assert.equal(hrefs.filter((h) => h.startsWith("#")).length, 5);
  assert.equal(count(s, "secretkey"), 0, "ids are never derived from the status key");
  assert.equal(count(s, 'd="M20 6 9 17l-5-5"'), 1, "the icon body appears once");
  assert.ok(s.indexOf("<defs>") < s.indexOf("<use "), "defs come before the nodes");
});

test("statusIcon: a standalone 12 x 12 svg with the export rules; statuses as given to createMindmap", () => {
  const s = statusIcon("decided");
  assert.ok(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"'), s);
  assert.ok(s.includes(`stroke="${THEME.green}"`));
  assert.ok(s.includes("<title>Decided</title>"));
  // merged with the default of the same key: a colour change keeps the built-in check
  const red = statusIcon("decided", { decided: { color: "red" } });
  assert.ok(red.includes('stroke="#cf222e"') && red.includes('stroke-linecap="round"'), red);
  assert.ok(statusIcon("x", { x: { render: () => null, image: "https://example.test/a.png", symbol: "#" } }).includes(">#</text>"));
  assert.ok(statusIcon("x", { x: { image: PNG } }).includes(`href="${PNG}"`));
  assert.ok(statusIcon("blocked", undefined, { red: "#000001" }).includes("#000001"));
  assert.equal(statusIcon("nope"), null);
});
