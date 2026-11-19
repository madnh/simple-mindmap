// Browser tests: headless Chrome through the DevTools protocol, REAL input events (mouse / keyboard).
// Needs Chrome or Chromium; set CHROME=/path/to/binary if it is not found. Without it every test is skipped.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, findChrome } from "./cdp.mjs";
import { startServer } from "../../demo/serve.mjs";

const HAVE = !!findChrome();
let page, srv;
const t = (name, fn) => test(name, { timeout: 60000, skip: HAVE ? false : "Chrome not found (set CHROME)" }, fn);

before(async () => {
  if (!HAVE) return;
  srv = await startServer(0);
  page = await launch();
  await page.goto(srv.url + "test/browser/page.html");
  await page.waitFor("window.ready === true");
});
after(async () => { if (page) await page.close(); if (srv) srv.server.close(); });

const ev = (expr) => page.eval(`(async () => { ${expr} })()`);
const names = () => page.eval("names()");
const center = async (id, sel) => { const c = await page.eval(`center(${JSON.stringify(id)}${sel ? ", " + JSON.stringify(sel) : ""})`); assert.ok(c, `node ${id} is drawn`); return c; };
const settle = () => page.eval("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
const SMALL = {
  title: "Small", layout: "right",
  root: { id: "r", title: "Root", children: [
    { id: "a", title: "Alpha", status: "decided", children: [{ id: "a1", title: "Alpha one" }, { id: "a2", title: "Alpha two" }] },
    { id: "b", title: "Beta", status: "pending" },
    { id: "c", title: "Gamma", tone: "red" },
  ] },
  links: [{ from: "b", to: "c", type: "blocks" }],
};
const make = (opts) => ev(`make(${JSON.stringify({ data: SMALL, ...opts })}); await new Promise((r) => setTimeout(r, 0));`);

t("createMindmap with bad data shows the error as text; a later valid setData draws", async () => {
  const r = await ev(`
    make({ data: { root: { id: "x", title: "X", children: [{ id: "x", title: "Banner" }] } }, strings: { invalid: "INVALID-TEXT" } });
    await Promise.resolve(); await Promise.resolve();
    const host = document.getElementById("host");
    const r = { text: host.textContent, nodes: host.querySelectorAll(".mm-node").length, errors: mm.errors.map((e) => e.code),
      data: mm.getData(), node: mm.getNode("x"), find: mm.find("x"), exp: mm.export("json"), ev: events.map((x) => [x.e, x.p.source]) };
    r.set = mm.setData(${JSON.stringify(SMALL)});
    r.after = host.querySelectorAll(".mm-node").length;
    r.errorsAfter = mm.errors.length;
    return r;`);
  assert.ok(r.text.includes("INVALID-TEXT"));
  assert.ok(r.text.includes('Id "x" is used by another node'));
  assert.equal(r.nodes, 0);
  assert.deepEqual(r.errors, ["dup_id"]);
  assert.equal(r.data, null); assert.equal(r.node, null); assert.deepEqual(r.find, []); assert.equal(r.exp, null);
  assert.deepEqual(r.ev, [["invalid", "init"]]);
  assert.equal(r.set.ok, true);
  assert.equal(r.after, 6);
  assert.equal(r.errorsAfter, 0);
});

t("setData with bad data keeps the drawn tree and returns {ok:false}", async () => {
  await make({ mode: "select" });
  const r = await ev(`
    const before = document.querySelector("#host .mm-nodes").outerHTML;
    const res = mm.setData({ root: { title: "" } });
    return { res, same: before === document.querySelector("#host .mm-nodes").outerHTML, data: mm.getData().root.title, ev: events.map((x) => [x.e, x.p.source]) };`);
  assert.equal(r.res.ok, false);
  assert.equal(r.res.errors[0].code, "missing_title");
  assert.ok(r.same);
  assert.equal(r.data, "Root");
  assert.deepEqual(r.ev, [["invalid", "setData"]]);
});

t("apply: a batch failing at op 3 changes nothing (data and picture), {ok:false, index:2}", async () => {
  await make({ mode: "select" });
  const r = await ev(`
    const before = document.querySelector("#host .mm-canvas").outerHTML;
    const d0 = JSON.stringify(mm.getData());
    const res = mm.apply([{ op: "edit", id: "a", title: "Changed" }, { op: "add", parent: "r", node: { id: "n", title: "New" } }, { op: "move", id: "a", parent: "a1" }]);
    return { res, sameDom: before === document.querySelector("#host .mm-canvas").outerHTML, sameData: d0 === JSON.stringify(mm.getData()), ev: events.map((x) => [x.e, x.p.source, x.p.index]) };`);
  assert.equal(r.res.ok, false);
  assert.equal(r.res.index, 2);
  assert.equal(r.res.errors[0].code, "move_into_self");
  assert.ok(r.sameDom, "picture unchanged");
  assert.ok(r.sameData, "data unchanged");
  assert.deepEqual(r.ev, [["invalid", "apply", 2]]);
});

t("getData() after apply equals the pure applyOps result, and is a copy", async () => {
  await make({ mode: "select" });
  const r = await ev(`
    const ops = [{ op: "add", parent: "a", node: { id: "a3", title: "Three" } }, { op: "status", id: "c", to: "blocked" }, { op: "meta", id: "b", meta: { by: "x" } }, { op: "link", from: "a3", to: "b" }];
    const pure = CORE.applyOps(${JSON.stringify(SMALL)}, ops);
    const res = mm.apply(ops);
    const got = mm.getData();
    got.root.title = "mutated"; got.root.children.length = 0;
    return { ok: res.ok, equal: JSON.stringify(pure.data) === JSON.stringify(mm.getData()), title: mm.getData().root.title, drawn: !!document.querySelector('#host [data-id="a3"]') };`);
  assert.equal(r.ok, true);
  assert.ok(r.equal);
  assert.equal(r.title, "Root", "returned data is a copy");
  assert.ok(r.drawn);
});

t("no interaction event is emitted by API calls (apply, setData, select, ...); state events are", async () => {
  await make({ mode: "edit", actions: [{ id: "x", label: "X" }] });
  const r = await ev(`
    mm.apply([{ op: "select", id: "a" }, { op: "collapse", id: "a" }, { op: "expand", id: "a" }, { op: "focus", id: "a" }, { op: "focus", id: null }, { op: "edit", id: "b", title: "B2" }]);
    mm.setData(${JSON.stringify(SMALL)});
    mm.select("b"); mm.reveal("a2"); mm.focus("a"); mm.focus(null); mm.collapse("a"); mm.expand("a");
    mm.setView("both"); mm.setView("outline"); mm.setView("right"); mm.fit(); mm.search("alpha"); mm.next(); mm.prev(); mm.search("");
    mm.apply([{ op: "nope" }]);
    await new Promise((r) => setTimeout(r, 100));
    return names();`);
  assert.deepEqual(r, ["invalid"]);
});

t("select mode: click selects, double click and Enter open, toggle button collapses", async () => {
  await make({ mode: "select" });
  let c = await center("b");
  await page.click(c.x, c.y);
  assert.deepEqual(await names(), ["select"]);
  assert.equal(await page.eval("mm.getState().selected"), "b");
  await page.key("Enter");
  c = await center("a");
  await page.dblclick(c.x, c.y);
  const evs = await page.eval("events.map((x) => [x.e, x.p.id])");
  assert.deepEqual(evs, [["select", "b"], ["open", "b"], ["select", "a"], ["open", "a"]]);
  const tg = await center("a", ".mm-toggle circle");
  await page.click(tg.x, tg.y);
  assert.deepEqual(await page.eval("events.at(-1)"), { e: "toggle", p: { id: "a", collapsed: true } });
  assert.equal(await page.eval(`!!document.querySelector('#host [data-id="a1"]')`), false);
  const chip = await center("a", ".mm-chip rect");
  await page.click(chip.x, chip.y);
  assert.deepEqual(await page.eval("events.at(-1)"), { e: "toggle", p: { id: "a", collapsed: false } });
});

t("keyboard: arrows move the selection and emit select; Space toggles", async () => {
  await make({ mode: "select" });
  const c = await center("a");
  await page.click(c.x, c.y);
  await page.key("ArrowDown");
  assert.equal(await page.eval("mm.getState().selected"), "b");
  await page.key("ArrowLeft");
  assert.equal(await page.eval("mm.getState().selected"), "r");
  await page.key("ArrowRight");
  assert.equal(await page.eval("mm.getState().selected"), "a");
  await page.key(" ");
  assert.deepEqual(await page.eval("events.map((x) => x.e)"), ["select", "select", "select", "select", "toggle"]);
});

t("view mode: clicks select nothing", async () => {
  await make({ mode: "view" });
  const c = await center("b");
  await page.click(c.x, c.y);
  await page.dblclick(c.x, c.y);
  await page.key("Enter");
  assert.deepEqual(await names(), []);
});

t("Enter in the search box goes to the next match and never emits open", async () => {
  await make({ mode: "select" });
  const c = await center("b");
  await page.click(c.x, c.y);
  await page.key("f", { modifiers: 4 }); // Meta+F focuses the search box
  if (!(await page.eval("document.activeElement && document.activeElement.type === 'search'"))) {
    await page.key("f", { modifiers: 2 }); // Ctrl+F on other platforms
  }
  assert.equal(await page.eval("document.activeElement.type"), "search");
  await page.type("alpha");
  const s1 = await page.eval("({ count: document.querySelector('#host .mm-count').textContent, state: mm.getState().search, last: events.at(-1) })");
  assert.equal(s1.count, "1 / 3 matches");
  assert.equal(s1.state, "alpha");
  assert.deepEqual(s1.last, { e: "search", p: { q: "alpha", hits: ["a", "a1", "a2"] } });
  await page.key("Enter", { text: "\r" });
  await page.key("Enter", { text: "\r" });
  const s2 = await page.eval("({ count: document.querySelector('#host .mm-count').textContent, names: names(), current: document.querySelector('#host .mm-node.is-current').getAttribute('data-id') })");
  assert.equal(s2.count, "3 / 3 matches");
  assert.equal(s2.current, "a2");
  assert.ok(!s2.names.includes("open"), `events: ${s2.names}`);
  await page.key("Enter", { modifiers: 8, text: "\r" }); // Shift+Enter: previous
  assert.equal(await page.eval("document.querySelector('#host .mm-count').textContent"), "2 / 3 matches");
  assert.ok(!(await names()).includes("open"));
});

t("search finds titles without accents and position numbers, not internal ids", async () => {
  await make({ mode: "select", data: { root: { id: "r", title: "Root", children: [{ id: "zz", title: "Chữ tiếng Việt" }, { id: "q", title: "Đường" }] } } });
  assert.deepEqual(await page.eval("mm.find('viet')"), ["zz"]);
  assert.deepEqual(await page.eval("mm.find('duong')"), ["q"]);
  assert.deepEqual(await page.eval("mm.find('2')"), ["q"]);
  assert.deepEqual(await page.eval("mm.find('zz')"), []);
});

t("edit mode emits intent only; the data never changes", async () => {
  await make({ mode: "edit" });
  const d0 = await page.eval("JSON.stringify(mm.getData())");
  // drag Beta onto Alpha -> move intent
  const b = await center("b"), a = await center("a");
  await page.drag(b.x, b.y, a.x, a.y);
  assert.deepEqual(await page.eval("events.filter((x) => x.e === 'intent').map((x) => x.p)"), [{ op: "move", id: "b", parent: "a" }]);
  // rename with F2
  await page.click(b.x, b.y);
  await page.key("F2");
  assert.equal(await page.eval("document.activeElement.className"), "mm-rename");
  await page.type("!");
  await page.key("Enter", { text: "\r" });
  await page.key("Tab");
  await page.key("Delete");
  const intents = await page.eval("events.filter((x) => x.e === 'intent').map((x) => x.p)");
  assert.deepEqual(intents.slice(1), [
    { op: "edit", id: "b", title: "!" },
    { op: "add", parent: "b", node: { title: "New idea" } },
    { op: "remove", id: "b" },
  ]);
  // menu: add sibling
  const more = await page.eval("(() => { const r = document.querySelector('#host .mm-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await page.click(more.x, more.y);
  const item = await page.eval("(() => { const b = [...document.querySelectorAll('#host .mm-menu button')].find((x) => x.textContent === 'Add sibling'); const r = b.getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; })()");
  await page.click(item.x, item.y);
  assert.deepEqual(await page.eval("events.filter((x) => x.e === 'intent').at(-1).p"), { op: "add", parent: "r", after: "b", node: { title: "New idea" } });
  assert.equal(await page.eval("JSON.stringify(mm.getData())"), d0, "data unchanged");
  assert.equal(await page.eval("document.querySelectorAll('#host .mm-node').length"), 6);
});

t("menu actions from the host: filtered by when(), emit action {action, id}", async () => {
  await ev(`make({ data: ${JSON.stringify(SMALL)}, mode: "select", actions: [{ id: "copy", label: "Copy id" }, { id: "only-decided", label: "Decided only", when: (n) => n.status === "decided" }] })`);
  const c = await center("b");
  await page.click(c.x, c.y);
  const more = await page.eval("(() => { const r = document.querySelector('#host .mm-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await page.click(more.x, more.y);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#host .mm-menu button')].map((b) => b.textContent)"), ["Copy id"]);
  const item = await page.eval("(() => { const r = document.querySelector('#host .mm-menu button').getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; })()");
  await page.click(item.x, item.y);
  assert.deepEqual(await page.eval("events.at(-1)"), { e: "action", p: { action: "copy", id: "b" } });
});

t("tools: layout buttons emit view; outline draws rows; wheel emits viewport", async () => {
  await make({ mode: "select" });
  const btn = (label) => page.eval(`(() => { const b = [...document.querySelectorAll('#host .mm-tools button')].find((x) => x.textContent === ${JSON.stringify(label)}); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  let p = await btn("Outline");
  await page.click(p.x, p.y);
  assert.equal(await page.eval("document.querySelectorAll('#host .mm-tree [role=treeitem]').length"), 6);
  p = await btn("Both sides");
  await page.click(p.x, p.y);
  assert.deepEqual(await page.eval("events.filter((x) => x.e === 'view').map((x) => x.p.kind)"), ["outline", "both"]);
  await page.wheel(500, 400, 0, 120);
  await settle();
  assert.ok((await names()).includes("viewport"));
  const vp = await page.eval("events.filter((x) => x.e === 'viewport').at(-1).p");
  assert.deepEqual(Object.keys(vp).sort(), ["k", "x", "y"]);
});

t("outline: click selects, arrow toggles, keyboard moves", async () => {
  await make({ mode: "select", view: "outline" });
  const row = await page.eval(`(() => { const r = document.querySelector('#host [data-id="a"] > .mm-row .mm-title').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; })()`);
  await page.click(row.x, row.y);
  await page.key("ArrowDown");
  assert.equal(await page.eval("mm.getState().selected"), "a1");
  const arrow = await page.eval(`(() => { const r = document.querySelector('#host [data-id="a"] > .mm-row .mm-arrow').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.click(arrow.x, arrow.y);
  assert.deepEqual(await page.eval("events.map((x) => x.e)"), ["select", "select", "toggle"]);
  assert.equal(await page.eval("mm.getState().selected"), "a", "selection moves out of a collapsed branch");
});

t("a title like <img onerror> is text, never markup", async () => {
  await ev(`window.pwned = 0; make({ mode: "select", data: { root: { title: "<img src=x onerror=window.pwned=1>", children: [{ id: "k", title: "<script>window.pwned=2</script>" }] } } });`);
  await page.eval("mm.setView('outline')");
  await new Promise((r) => setTimeout(r, 200));
  const r = await page.eval("({ img: document.querySelectorAll('#host img, #host script').length, pwned: window.pwned, text: document.getElementById('host').textContent.includes('<img src=x') })");
  assert.deepEqual(r, { img: 0, pwned: 0, text: true });
});

t("badge(node) is called again after a meta op and the picture follows", async () => {
  await ev(`make({ data: ${JSON.stringify(SMALL)}, mode: "select", badge: (n) => (n.meta && n.meta.by ? { symbol: "*" + n.meta.by, label: "changed" } : null) })`);
  assert.equal(await page.eval("document.querySelectorAll('#host .mm-badge').length"), 0);
  await page.eval(`mm.apply([{ op: "meta", id: "b", meta: { by: "agent" } }])`);
  assert.equal(await page.eval(`document.querySelector('#host [data-id="b"] .mm-badge text').textContent`), "*agent");
  await page.eval(`mm.apply([{ op: "meta", id: "b", meta: { by: "me" } }])`);
  assert.equal(await page.eval(`document.querySelector('#host [data-id="b"] .mm-badge text').textContent`), "*me");
});

t("six status symbols and tone dots are drawn; superseded is struck through", async () => {
  await ev(`make({ data: await fixture("statuses-tones.json"), view: "right" })`);
  const r = await page.eval("({ status: document.querySelectorAll('#host .mm-status').length, tone: document.querySelectorAll('#host .mm-tone').length, sup: document.querySelectorAll('#host .is-superseded').length })");
  assert.deepEqual(r, { status: 6, tone: 6, sup: 1 });
});

t("state round trip: getState() fed back to createMindmap restores the view", async () => {
  await make({ mode: "select" });
  const s = await page.eval(`mm.collapse("a"); mm.select("b"); mm.setView("both"); mm.search("gam"); mm.getState()`);
  const back = await page.eval(`make({ data: ${JSON.stringify(SMALL)}, view: "outline", state: ${JSON.stringify(s)} }).getState()`);
  assert.deepEqual(back, s);
  assert.equal(s.view, "both", "state.view wins over the view option");
});

t("large data: > 80 nodes opens collapsed to depth 2; 2000 nodes render time printed", async () => {
  const r = await ev(`
    const data = await fixture("large-2000.json");
    let t0 = performance.now();
    make({ data, mode: "select" });
    const first = performance.now() - t0;
    const drawn = document.querySelectorAll("#host .mm-node").length;
    t0 = performance.now();
    mm.setData(data); mm.setView("right"); mm.apply(mm.getState().collapsed.map((id) => ({ op: "expand", id })));
    const full = performance.now() - t0;
    const all = document.querySelectorAll("#host .mm-node").length;
    t0 = performance.now(); mm.setView("both"); const both = performance.now() - t0;
    t0 = performance.now(); const svg = mm.export("svg"); const exp = performance.now() - t0;
    return { first, drawn, full, all, both, exp, svgLen: svg.length };`);
  assert.ok(r.drawn < 2000 && r.drawn > 1, `collapsed draw shows ${r.drawn}`);
  assert.equal(r.all, 2000);
  console.log(`# browser 2000 nodes: first draw (collapsed, ${r.drawn} drawn) ${r.first.toFixed(0)} ms; expand all + draw right ${r.full.toFixed(0)} ms; switch to both ${r.both.toFixed(0)} ms; export svg ${r.exp.toFixed(0)} ms (${r.svgLen} bytes)`);
});

t("export(svg) from the page: concrete theme colours, real text measuring", async () => {
  await make({ mode: "select" });
  const s = await page.eval(`document.querySelector("#host .simple-mindmap").style.setProperty("--mm-root-bg", "#abcdef"); mm.export("svg")`);
  assert.ok(s.startsWith("<svg"));
  assert.ok(s.includes("#abcdef"));
  assert.ok(!s.includes("var("));
  assert.equal(await page.eval("mm.export('mermaid').split('\\n')[0]"), "mindmap");
});

t("a rendering failure is caught: error text + error event, the page keeps working", async () => {
  const r = await ev(`
    const orig = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = () => { throw new Error("boom"); };
    try {
      make({ data: { root: { title: "Unmeasured title " + Math.random() } }, strings: { renderFailed: "RENDER-FAILED" } });
    } finally { CanvasRenderingContext2D.prototype.measureText = orig; }
    await Promise.resolve(); await Promise.resolve();
    return { text: document.getElementById("host").textContent, ev: events.map((x) => [x.e, x.p.message]) };`);
  assert.ok(r.text.includes("RENDER-FAILED"));
  assert.deepEqual(r.ev, [["error", "boom"]]);
});

t("CSS is injected once per document as <style id=simple-mindmap-css>; destroy removes the component", async () => {
  const r = await ev(`
    const extra = document.createElement("div"); document.body.appendChild(extra);
    const m2 = SM.createMindmap(extra, { data: { root: { title: "x" } } });
    const styles = document.querySelectorAll("style#simple-mindmap-css").length;
    m2.destroy();
    const left = extra.childNodes.length; extra.remove();
    return { styles, left };`);
  assert.deepEqual(r, { styles: 1, left: 0 });
});
