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
after(async () => {
  try { if (page) await page.close(); } finally { if (srv) { srv.server.closeAllConnections(); srv.server.close(); } }
});

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
  assert.deepEqual(await page.eval("events.map((x) => [x.e, x.p.id])"), [["select", "a"], ["select", "a1"], ["toggle", "a"], ["select", "a"]],
    "a toggle that moves the selection reports the new selection");
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
      make({ data: { root: { title: "Unmeasured title " + Math.random() } }, strings: { renderFailed: "RENDER-FAILED", renderFailedDetail: "DETAIL<{message}>" } });
    } finally { CanvasRenderingContext2D.prototype.measureText = orig; }
    await Promise.resolve(); await Promise.resolve();
    return { text: document.getElementById("host").textContent, ev: events.map((x) => [x.e, x.p.message]) };`);
  assert.ok(r.text.includes("RENDER-FAILED"));
  assert.ok(r.text.includes("DETAIL<boom>"), "the failure detail goes through strings");
  assert.deepEqual(r.ev, [["error", "boom"]]);
});

t("status filter: setFilter dims non-matching nodes (map and outline), emits nothing, rejects unknown statuses", async () => {
  await make({ mode: "select" });
  const r = await ev(`
    const res = mm.setFilter(["pending", "decided"]);
    const dimMap = [...document.querySelectorAll("#host .mm-node.is-dim")].map((g) => g.getAttribute("data-id")).sort();
    const bad = mm.setFilter(["nope"]);
    const still = mm.getState().filter;
    mm.setView("outline");
    const dimRows = [...document.querySelectorAll("#host .mm-row.is-dim")].map((r) => r.closest("li").dataset.id).sort();
    const rows = document.querySelectorAll("#host [role=treeitem]").length;
    mm.setFilterOnly(true);
    const shown = [...document.querySelectorAll("#host [role=treeitem]")].map((li) => li.dataset.id);
    mm.setFilter(null);
    const cleared = document.querySelectorAll("#host .is-dim").length;
    await new Promise((r) => setTimeout(r, 50));
    return { res, dimMap, bad, still, dimRows, rows, shown, cleared, events: names() };`);
  assert.deepEqual(r.res, { ok: true });
  assert.deepEqual(r.dimMap, ["a1", "a2", "c", "r"], "dimmed, not hidden");
  assert.equal(r.bad.ok, false);
  assert.equal(r.bad.errors[0].code, "bad_status");
  assert.deepEqual(r.still, ["pending", "decided"], "a rejected filter changes nothing");
  assert.deepEqual(r.dimRows, ["a1", "a2", "c", "r"]);
  assert.equal(r.rows, 6, "outline keeps every row without filterOnly");
  assert.deepEqual(r.shown, ["r", "a", "b"], "filterOnly hides branches without a match");
  assert.equal(r.cleared, 0);
  assert.deepEqual(r.events, []);
});

t("status filter: option, state round trip, SVG export fades the same nodes", async () => {
  await make({ mode: "select", filter: ["blocked"], filterOnly: true, view: "outline" });
  const s = await page.eval("mm.getState()");
  assert.deepEqual([s.filter, s.filterOnly], [["blocked"], true]);
  const back = await page.eval(`make({ data: ${JSON.stringify(SMALL)}, state: ${JSON.stringify(s)} }).getState()`);
  assert.deepEqual([back.filter, back.filterOnly], [["blocked"], true]);
  const svg = await page.eval(`mm.setView("right"); mm.setFilter(["decided"]); mm.export("svg")`);
  assert.equal((svg.match(/opacity="0.35"/g) || []).length, 5);
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

const box = (sel) => page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, bottom: r.bottom }; })()`);

t("a user click on the node the host already selected still emits select", async () => {
  await make({ mode: "select" });
  await ev(`mm.select("b"); events.length = 0;`);
  const c = await center("b");
  await page.click(c.x, c.y);
  await settle();
  assert.deepEqual(await page.eval("events.filter((x) => x.e === 'select').map((x) => x.p.id)"), ["b"]);
});

t("focusSearch() puts the cursor in the search box of the open view, emits nothing", async () => {
  await make({ mode: "select" });
  const r = await ev(`
    document.body.focus();
    const map = mm.focusSearch(), inMap = document.activeElement && document.activeElement.type === "search" && !!document.activeElement.closest("#host");
    mm.setView("outline"); document.body.focus();
    const ol = mm.focusSearch(), inOutline = document.activeElement && document.activeElement.type === "search" && !!document.activeElement.closest("#host .mm-outline");
    const ev0 = events.length;
    make({ data: ${JSON.stringify(SMALL)}, search: false });
    return { map, inMap, ol, inOutline, ev0, off: mm.focusSearch() };`);
  assert.deepEqual(r, { map: true, inMap: true, ol: true, inOutline: true, ev0: 0, off: false });
});

t("menu actions draw icon as text before the label", async () => {
  await ev(`make({ data: ${JSON.stringify(SMALL)}, mode: "select", actions: [{ id: "copy", label: "Copy id", icon: "<b>#</b>" }, { id: "plain", label: "Plain" }] })`);
  const c = await center("b");
  await page.click(c.x, c.y);
  const more = await box("#host .mm-more");
  await page.click(more.x, more.y);
  const r = await page.eval(`[...document.querySelectorAll('#host .mm-menu button')].map((b) => ({ icon: b.querySelector(".mm-icon") ? b.querySelector(".mm-icon").textContent : null, text: b.textContent, tags: b.querySelectorAll("b").length }))`);
  assert.deepEqual(r, [{ icon: "<b>#</b>", text: "<b>#</b>Copy id", tags: 0 }, { icon: null, text: "Plain", tags: 0 }]);
  const item = await box("#host .mm-menu button");
  await page.click(item.x, item.y);
  assert.deepEqual(await page.eval("events.at(-1)"), { e: "action", p: { action: "copy", id: "b" } });
});

t("focus crumbs: inside the map at the bottom left, one button per level, a click focuses that level", async () => {
  await make({ mode: "select" });
  await ev(`mm.focus("a1");`);
  const host = await page.eval("(() => { const r = document.getElementById('host').getBoundingClientRect(); return { left: r.left, bottom: r.bottom }; })()");
  const nav = await box("#host .simple-mindmap > .mm-crumbs");
  assert.ok(nav.left - host.left < 40 && host.bottom - nav.bottom < 40, `crumbs at the bottom left (${JSON.stringify(nav)})`);
  const crumbs = () => page.eval(`[...document.querySelectorAll('#host .mm-crumbs button')].map((b) => [b.textContent, b.getAttribute("aria-current")])`);
  assert.deepEqual(await crumbs(), [["Root", null], ["Alpha", null], ["Alpha one", "true"]]);
  let b = await box("#host .mm-crumbs button:nth-of-type(2)");
  await page.click(b.x, b.y);
  assert.equal(await page.eval("mm.getState().focus"), "a");
  assert.deepEqual(await crumbs(), [["Root", null], ["Alpha", "true"]]);
  b = await box("#host .mm-crumbs button");
  await page.click(b.x, b.y);
  assert.equal(await page.eval("mm.getState().focus"), null);
  assert.equal(await page.eval("document.querySelectorAll('#host .mm-crumbs').length"), 0, "no crumbs without a focused branch");
  assert.equal(await page.eval("document.querySelectorAll('#host .mm-node').length"), 6);
});

t("setData keeps selection, collapsed nodes and viewport by id; drops what is gone", async () => {
  await make({ mode: "select" });
  await ev(`mm.select("b"); mm.collapse("a");`);
  await page.wheel(500, 400, 0, 120);
  await settle();
  const before = await page.eval("mm.getState()");
  const next = structuredClone(SMALL);
  next.root.children.reverse();
  next.root.children.push({ id: "d", title: "Delta" });
  const r = await ev(`const res = mm.setData(${JSON.stringify(next)}); return { res: res.ok, st: mm.getState(), drawn: document.querySelectorAll("#host .mm-node").length };`);
  assert.equal(r.res, true);
  assert.equal(r.st.selected, "b");
  assert.deepEqual(r.st.collapsed, ["a"]);
  assert.deepEqual(r.st.viewport, before.viewport);
  assert.equal(r.drawn, 5, "r, c, b, a (collapsed), d");
  const gone = structuredClone(SMALL);
  gone.root.children = gone.root.children.filter((c) => c.id !== "b" && c.id !== "a");
  delete gone.links;
  const g = await ev(`mm.setData(${JSON.stringify(gone)}); return mm.getState();`);
  assert.equal(g.selected, null);
  assert.deepEqual(g.collapsed, []);
});

t("collapseDepth: branches at that depth and deeper open collapsed", async () => {
  const r = await ev(`
    make({ data: ${JSON.stringify(SMALL)}, collapseDepth: 1 });
    const one = { c: mm.getState().collapsed, n: document.querySelectorAll("#host .mm-node").length };
    make({ data: ${JSON.stringify(SMALL)}, collapseDepth: 0 });
    const zero = { c: mm.getState().collapsed.sort(), n: document.querySelectorAll("#host .mm-node").length };
    make({ data: ${JSON.stringify(SMALL)} });
    const none = { c: mm.getState().collapsed, n: document.querySelectorAll("#host .mm-node").length };
    return { one, zero, none };`);
  assert.deepEqual(r.one, { c: ["a"], n: 4 });
  assert.deepEqual(r.zero, { c: ["a", "r"], n: 1 });
  assert.deepEqual(r.none, { c: [], n: 6 });
});

t("theming: --mm-* set on an ancestor or on .simple-mindmap wins, also under OS dark; SVG export uses it", async () => {
  try {
    const r = await ev(`
      const st = document.createElement("style"); st.id = "host-theme";
      st.textContent = "#host { --mm-bg: #123456; --mm-node-bg: #abcdef; }";
      document.head.appendChild(st);
      make({ data: ${JSON.stringify(SMALL)} });
      const w = document.querySelector("#host .simple-mindmap");
      const first = document.head.firstElementChild.id;
      const out = { first, bg: getComputedStyle(w).backgroundColor, box: getComputedStyle(document.querySelector('#host [data-id="b"] .mm-box')).fill, svg: mm.export("svg") };
      out.svgBg = out.svg.includes("#123456"); out.svgNode = out.svg.includes("#abcdef"); delete out.svg;
      return out;`);
    assert.deepEqual(r, { first: "simple-mindmap-css", bg: "rgb(18, 52, 86)", box: "rgb(171, 205, 239)", svgBg: true, svgNode: true });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    const d = await ev(`
      const w = document.querySelector("#host .simple-mindmap");
      const anc = getComputedStyle(w).backgroundColor;
      document.getElementById("host-theme").textContent = ".simple-mindmap { --mm-bg: #654321; }";
      const el = getComputedStyle(w).backgroundColor;
      document.getElementById("host-theme").textContent = "";
      const def = getComputedStyle(w).backgroundColor;
      return { anc, el, def };`);
    assert.deepEqual(d, { anc: "rgb(18, 52, 86)", el: "rgb(101, 67, 33)", def: "rgb(13, 17, 23)" }, "host values beat the dark palette; without them the dark default applies");
  } finally {
    await page.send("Emulation.setEmulatedMedia", { features: [] });
    await ev(`const s = document.getElementById("host-theme"); if (s) s.remove();`);
  }
});

t("getNode() returns a copy: changing it changes neither the data nor the picture", async () => {
  await make({ mode: "select" });
  const r = await ev(`
    mm.apply([{ op: "meta", id: "b", meta: { by: "x" } }]);
    const before = JSON.stringify(mm.getData());
    const g = mm.getNode("b");
    g.node.title = "MUTATED"; g.node.status = "blocked"; g.node.meta.by = "MUTATED"; g.children.push("zz");
    mm.setFilter(null); // forces a redraw from the component's own data
    return { same: before === JSON.stringify(mm.getData()), again: mm.getNode("b"), text: document.querySelector('#host [data-id="b"]').textContent };`);
  assert.ok(r.same, "getData unchanged");
  assert.deepEqual(r.again, { id: "b", path: "2", parent: "r", children: [], node: { id: "b", title: "Beta", status: "pending", meta: { by: "x" } } });
  assert.ok(r.text.includes("Beta") && !r.text.includes("MUTATED"));
});

// ---- 1.1: status icons, theming ----
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const ICONS = { root: { id: "r", title: "Root", children: [
  { id: "a", title: "Icon", status: "decided" }, { id: "b", title: "Image", status: "pending" }, { id: "c", title: "Render", status: "open" },
  { id: "d", title: "Symbol", status: "parked" }, { id: "e", title: "Superseded", status: "superseded" }, { id: "f", title: "Dropped", status: "dropped" },
  { id: "g", title: "Plain", status: "blocked" },
] } };
const ICON_STATUSES = `{
  decided: { icon: { nodes: [["path", { d: "M1 1L11 11" }]], viewBox: "0 0 12 12" } },
  pending: { image: ${JSON.stringify(PNG)} },
  open: { render: (k) => { const e = document.createElementNS("http://www.w3.org/2000/svg", "circle"); e.setAttribute("class", "custom-" + k); e.setAttribute("r", "5"); return e; } },
  parked: { symbol: "P" },
  superseded: { icon: { nodes: [["circle", { cx: 12, cy: 12, r: 6 }]] } },
  dropped: { label: "Dropped", symbol: "x", strike: true },
  blocked: {},
}`;

t("map and outline draw the same icon levels (icon, image, render, symbol over an inherited shape); strike follows `strike`", async () => {
  const r = await ev(`
    make({ data: ${JSON.stringify(ICONS)}, view: "right", statuses: ${ICON_STATUSES} });
    await new Promise((r) => setTimeout(r, 0));
    const q = (id, sel) => document.querySelector('#host [data-id="' + id + '"] ' + sel);
    const via = (u) => (u ? document.querySelector("#host " + u.getAttribute("href")) : null); // <use> -> its <symbol>
    const map = {
      icon: !!via(q("a", ".mm-status use"))?.querySelector("path[d='M1 1L11 11']"), image: via(q("b", ".mm-status use"))?.querySelector("image")?.getAttribute("href"),
      render: !!q("c", ".mm-status .mm-status-render circle.custom-open"),
      symbol: [...document.querySelectorAll('#host [data-id="d"] .mm-status text')].map((t) => t.textContent),
      plain: !!q("g", ".mm-status circle"),
      strike: ["e", "f", "d"].map((id) => document.querySelector('#host [data-id="' + id + '"]').classList.contains("is-superseded")),
    };
    mm.setView("outline");
    await new Promise((r) => setTimeout(r, 0));
    const row = (id) => document.querySelector('#host li[data-id="' + id + '"] > .mm-row');
    const outline = {
      icon: !!via(row("a").querySelector("svg.mm-sym use"))?.querySelector("path[d='M1 1L11 11']"), image: via(row("b").querySelector("svg.mm-sym use"))?.querySelector("image")?.getAttribute("href"),
      render: !!row("c").querySelector("span.mm-sym-render circle.custom-open"),
      symbol: row("d").querySelector("svg.mm-sym text")?.textContent,
      strike: ["e", "f", "d"].map((id) => row(id).classList.contains("is-superseded")),
    };
    return { map, outline, errors: events.filter((x) => x.e === "error").length };`);
  assert.deepEqual(r.map, { icon: true, image: PNG, render: true, symbol: ["P"], plain: true, strike: [true, true, false] });
  assert.deepEqual(r.outline, { icon: true, image: PNG, render: true, symbol: "P", strike: [true, true, false] });
  assert.equal(r.errors, 0);
});

t("status render(): once per status key per draw (copied per node), never for the export; a throw or a non-Element falls back with one error per key per draw", async () => {
  const r = await ev(`
    window.calls = {};
    const count = (k) => { window.calls[k] = (window.calls[k] || 0) + 1; };
    const kids = [];
    for (let i = 0; i < 6; i++) kids.push({ id: "d" + i, title: "D" + i, status: "decided" });
    for (let i = 0; i < 3; i++) kids.push({ id: "b" + i, title: "B" + i, status: "blocked" });
    for (let i = 0; i < 2; i++) kids.push({ id: "o" + i, title: "O" + i, status: "open" });
    make({ data: { root: { id: "r", title: "R", children: kids } }, view: "right", statuses: {
      decided: { render: (k) => { count(k); const e = document.createElementNS("http://www.w3.org/2000/svg", "rect"); e.setAttribute("class", "custom"); return e; } },
      blocked: { symbol: "!", render: () => { count("blocked"); throw new Error("boom"); } },
      open: { symbol: "?", render: () => { count("open"); return "not an element"; } },
    } });
    await new Promise((r) => setTimeout(r, 0));
    const host = document.getElementById("host");
    const errs = () => events.filter((x) => x.e === "error").map((x) => x.p.status);
    const texts = (p) => [...host.querySelectorAll('[data-id^="' + p + '"] .mm-status text')].map((t) => t.textContent);
    const first = { calls: { ...window.calls }, custom: host.querySelectorAll(".mm-node .custom").length, bang: texts("b"), q: texts("o"), errors: errs() };
    mm.setFilter(["decided"]); // one more draw
    const second = { calls: { ...window.calls }, errors: errs() };
    const svg = mm.export("svg");
    return { first, second, after: { ...window.calls }, exp: svg.includes("custom") || svg.includes("foreignObject"), msg: events.find((x) => x.e === "error").p.message };`);
  const f = r.first, s = r.second;
  assert.equal(f.custom, 6, "every node gets its copy");
  assert.ok(f.calls.decided >= 1 && f.calls.decided < 6, `render called ${f.calls.decided} times for 6 nodes`);
  assert.equal(f.calls.blocked, f.calls.decided); assert.equal(f.calls.open, f.calls.decided);
  assert.deepEqual(f.bang, ["!", "!", "!"]); assert.deepEqual(f.q, ["?", "?"]);
  assert.equal(f.errors.filter((k) => k === "blocked").length, f.calls.blocked, "one error per key per draw");
  assert.equal(f.errors.filter((k) => k === "open").length, f.calls.open);
  assert.equal(s.calls.decided, f.calls.decided + 1);
  assert.equal(s.errors.length, f.errors.length + 2);
  assert.deepEqual(r.after, s.calls, "export does not call render");
  assert.equal(r.exp, false);
  assert.ok(r.msg.includes("boom"));
});

const THEMES = `{
  solarized: { base: "light", tokens: { bg: "#fdf6e3", "node-bg": "#eee8d5" } },
  midnight: { base: "dark", tokens: { bg: "#0b1020" } },
  light: { tokens: { "edge-0": "#111111" } },
  broken: { base: "blue" },
}`;

t("themes: named themes on a light/dark base; a switch removes the old tokens; unknown name changes nothing; export follows; no event, no redraw", async () => {
  const r = await ev(`
    make({ data: ${JSON.stringify(SMALL)}, themes: ${THEMES}, theme: "solarized" });
    await new Promise((r) => setTimeout(r, 0));
    const w = document.querySelector("#host .simple-mindmap");
    const n0 = events.length;
    const node = document.querySelector('#host [data-id="a"]');
    const tok = (k) => w.style.getPropertyValue("--mm-" + k);
    const snap = () => ({ mode: w.dataset.theme ?? null, bg: tok("bg"), nodeBg: tok("node-bg"), edge0: tok("edge-0"), state: mm.getState().theme });
    const out = { s0: snap(), exp0: mm.export("svg"), warn0: mm.warnings.map((x) => [x.path, x.code]) };
    out.r1 = mm.setTheme("midnight"); out.s1 = snap(); out.exp1 = mm.export("svg");
    out.r2 = mm.setTheme("nope"); out.s2 = snap();
    out.bad = [42, { base: "blue" }, { tokens: "x" }, "broken"].map((x) => mm.setTheme(x).errors?.[0]?.code); out.s3 = snap();
    out.r4 = mm.setTheme({ base: "dark", tokens: { bg: "#000001", nonsense: "x" } }); out.s4 = snap(); out.warn4 = mm.warnings.map((x) => [x.path, x.code]);
    out.r5 = mm.setTheme("light"); out.s5 = snap();
    out.r6 = mm.setTheme(null); out.s6 = snap();
    out.sameNode = node === document.querySelector('#host [data-id="a"]');
    out.events = events.slice(n0).map((x) => x.e);
    return out;`);
  assert.deepEqual(r.s0, { mode: "light", bg: "#fdf6e3", nodeBg: "#eee8d5", edge0: "", state: "solarized" });
  assert.ok(r.exp0.includes("#fdf6e3") && r.exp0.includes("#eee8d5"));
  assert.deepEqual(r.warn0, [["themes.broken", "bad_value"]]);
  assert.deepEqual(r.r1, { ok: true });
  assert.deepEqual(r.s1, { mode: "dark", bg: "#0b1020", nodeBg: "", edge0: "", state: "midnight" }, "the old theme's tokens are removed");
  assert.ok(r.exp1.includes("#0b1020") && r.exp1.includes("#161b22") && !r.exp1.includes("#eee8d5"), "dark base under the theme");
  assert.equal(r.r2.ok, false); assert.equal(r.r2.errors[0].code, "bad_theme"); assert.equal(r.r2.errors[0].path, "theme");
  assert.deepEqual(r.s2, r.s1, "an unknown name changes nothing");
  assert.deepEqual(r.bad, ["bad_theme", "bad_theme", "bad_theme", "bad_theme"]); assert.deepEqual(r.s3, r.s1);
  assert.deepEqual(r.r4, { ok: true });
  assert.deepEqual(r.s4, { mode: "dark", bg: "#000001", nodeBg: "", edge0: "", state: null }, "an inline theme has no name");
  assert.deepEqual(r.warn4, [["themes.broken", "bad_value"], ["theme.tokens.nonsense", "unknown_key"]]);
  assert.deepEqual(r.s5, { mode: "light", bg: "", nodeBg: "", edge0: "#111111", state: "light" }, "a host override of the built-in light");
  assert.deepEqual(r.s6, { mode: null, bg: "", nodeBg: "", edge0: "", state: null }, "null follows the OS");
  assert.equal(r.sameNode, true, "no redraw");
  assert.deepEqual(r.events, []);
});

t("themes: getState().theme round trip restores the named theme; an old state without theme keeps the option", async () => {
  const r = await ev(`
    make({ data: ${JSON.stringify(SMALL)}, themes: ${THEMES}, theme: "solarized" });
    mm.setTheme("midnight");
    const st = mm.getState();
    make({ data: ${JSON.stringify(SMALL)}, themes: ${THEMES}, theme: "solarized", state: st });
    const w = () => document.querySelector("#host .simple-mindmap");
    const a = { theme: mm.getState().theme, mode: w().dataset.theme, bg: w().style.getPropertyValue("--mm-bg") };
    const { theme, ...old } = st;
    make({ data: ${JSON.stringify(SMALL)}, themes: ${THEMES}, theme: "solarized", state: old });
    const b = { theme: mm.getState().theme, bg: w().style.getPropertyValue("--mm-bg") };
    make({ data: ${JSON.stringify(SMALL)}, theme: "nope" });
    const c = { theme: mm.getState().theme, mode: w().dataset.theme ?? null, warn: mm.warnings.map((x) => x.code) };
    return { st: st.theme, a, b, c };`);
  assert.equal(r.st, "midnight");
  assert.deepEqual(r.a, { theme: "midnight", mode: "dark", bg: "#0b1020" });
  assert.deepEqual(r.b, { theme: "solarized", bg: "#fdf6e3" });
  assert.deepEqual(r.c, { theme: null, mode: null, warn: ["bad_theme"] });
});

t("A1: icons are <symbol>s used per node; ids carry a per-instance prefix and never the status key; outline has one hidden defs svg", async () => {
  const r = await ev(`
    const host = document.getElementById("host");
    const second = document.createElement("div"); second.id = "host2"; second.style.cssText = "position:absolute;left:0;top:700px;width:600px;height:300px";
    document.body.appendChild(second);
    try {
      const st = { secretkey: { label: "S", icon: { nodes: [["circle", { cx: 12, cy: 12, r: 9 }]] } }, other: { label: "O", path: "M1 1L11 11" } };
      const data = { root: { id: "r", title: "R", children: [1, 2, 3, 4].map((i) => ({ id: "n" + i, title: "N" + i, status: i < 4 ? "secretkey" : "other" })) } };
      make({ data, view: "right", statuses: st });
      const mm2 = SM.createMindmap(second, { data, view: "right", statuses: st });
      const ids = (el) => [...el.querySelectorAll("symbol")].map((s) => s.id);
      const uses = (el) => [...el.querySelectorAll(".mm-status use")].map((u) => u.getAttribute("href"));
      const out = { ids1: ids(host), ids2: ids(second), uses1: uses(host), resolved: uses(host).every((h) => host.querySelector(h)) };
      mm.setView("outline");
      out.outlineDefs = host.querySelectorAll(".mm-outline svg.mm-defs").length;
      out.outlineIds = ids(host);
      out.rowUses = [...host.querySelectorAll(".mm-row svg.mm-sym use")].map((u) => u.getAttribute("href"));
      out.rowResolved = out.rowUses.every((h) => host.querySelector(h));
      mm2.destroy();
      return out;
    } finally { second.remove(); }`);
  assert.equal(r.ids1.length, 2); assert.equal(r.ids2.length, 2);
  assert.equal(new Set([...r.ids1, ...r.ids2]).size, 4, `ids collide: ${r.ids1} / ${r.ids2}`);
  assert.ok(r.ids1.every((id) => /^mm\d+-s-\d+$/.test(id) && !id.includes("secret")), r.ids1.join());
  assert.equal(r.uses1.length, 4); assert.ok(r.resolved);
  assert.ok(r.uses1.every((h) => h.startsWith("#")));
  assert.equal(r.outlineDefs, 1);
  assert.ok(r.outlineIds.length === 2 && r.outlineIds.every((id) => /^mm\d+-os-\d+$/.test(id)), r.outlineIds.join());
  assert.equal(r.rowUses.length, 4); assert.ok(r.rowResolved);
});

t("export: a raw var() status colour is resolved by the page (computed rgb); the file never contains var(", async () => {
  const r = await ev(`
    const host = document.getElementById("host");
    host.style.setProperty("--brand", "#123456");
    try {
      make({ data: ${JSON.stringify(SMALL)}, statuses: { decided: { color: "var(--brand)" }, pending: { color: "var(--brand)", icon: { nodes: [["circle", { cx: 12, cy: 12, r: 8 }]], stroke: true } } } });
      const svg = mm.export("svg");
      return { vars: svg.split("var(").length - 1, rgb: svg.split("rgb(18, 52, 86)").length - 1 };
    } finally { host.style.removeProperty("--brand"); }`);
  assert.equal(r.vars, 0);
  assert.equal(r.rgb, 2, "both statuses drawn with the resolved colour");
});

t("setStatusStyle: restyles an existing status, keeping viewport, collapse and selection; unknown key -> bad_status; no event", async () => {
  await make({ mode: "select" });
  const r = await ev(`
    mm.select("b"); mm.collapse("a"); mm.fit();
    const st0 = JSON.stringify(mm.getState());
    const n0 = events.length;
    const ok = mm.setStatusStyle("decided", { color: "red", icon: { nodes: [["circle", { cx: 12, cy: 12, r: 8 }]] } });
    const st1 = JSON.stringify(mm.getState());
    const u = document.querySelector('#host [data-id="a"] .mm-status use');
    const icon = !!(u && document.querySelector("#host " + u.getAttribute("href") + ' circle[r="8"]'));
    const shape = !!document.querySelector('#host [data-id="a"] .mm-status path');
    const label = mm.export("svg").includes("<title>Decided</title>");
    const back = mm.setStatusStyle("decided", { icon: null, shape: "decided" });
    const check = !!document.querySelector('#host [data-id="a"] .mm-status path');
    return { ok, back, same: st0 === st1, icon, shape, label, check, unknown: mm.setStatusStyle("nope", { color: "red" }), notObj: mm.setStatusStyle("decided", "red"), events: events.slice(n0).map((x) => x.e) };`);
  assert.deepEqual(r.ok, { ok: true }); assert.deepEqual(r.back, { ok: true });
  assert.ok(r.same, "state kept");
  assert.equal(r.icon, true); assert.equal(r.shape, false, "the inherited shape is replaced");
  assert.equal(r.label, true, "label inherits");
  assert.equal(r.check, true);
  assert.equal(r.unknown.ok, false); assert.equal(r.unknown.errors[0].code, "bad_status");
  assert.equal(r.notObj.ok, false); assert.equal(r.notObj.errors[0].code, "bad_status");
  assert.deepEqual(r.events, []);
});

t("actions[].icon: an icon object draws an svg before the label; a string stays text; a rejected icon draws none", async () => {
  await ev(`make({ data: ${JSON.stringify(SMALL)}, mode: "select", actions: [
    { id: "x", label: "X", icon: { nodes: [["path", { d: "M1 1L11 11" }], ["script", {}]], viewBox: "0 0 12 12" } },
    { id: "y", label: "Y", icon: "*" }, { id: "z", label: "Z", icon: { nodes: [["script", {}]] } }] })`);
  const c = await center("b");
  await page.click(c.x, c.y);
  const more = await page.eval("(() => { const r = document.querySelector('#host .mm-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await page.click(more.x, more.y);
  const items = await page.eval(`[...document.querySelectorAll('#host .mm-menu button')].slice(0, 3).map((b) => ({
    text: b.textContent, svg: !!b.querySelector(".mm-icon svg path[d='M1 1L11 11']"), script: !!b.querySelector("script"), icon: b.querySelector(".mm-icon")?.textContent ?? null }))`);
  assert.deepEqual(items, [
    { text: "X", svg: true, script: false, icon: "" },
    { text: "*Y", svg: false, script: false, icon: "*" },
    { text: "Z", svg: false, script: false, icon: null },
  ]);
});

t("Lucide in the page: icon {nodes, stroke} and render via lucide createElement draw; 2 000 nodes draw time with a render() status printed", async () => {
  const r = await ev(`
    const L = await import("/node_modules/lucide/dist/esm/lucide.mjs");
    make({ data: ${JSON.stringify(SMALL)}, view: "right", statuses: {
      decided: { color: "green", icon: { nodes: L.CircleCheck, stroke: true } },
      pending: { color: "amber", render: () => L.createElement(L.Hourglass, { width: 12, height: 12 }) },
    } });
    await new Promise((r) => setTimeout(r, 0));
    const ua = document.querySelector('#host [data-id="a"] .mm-status use');
    const a = ua && document.querySelector("#host " + ua.getAttribute("href"));
    const b = document.querySelector('#host [data-id="b"] .mm-status .mm-status-render svg');
    const out = { a: a && ["viewBox", "fill", "stroke-width", "stroke-linecap", "stroke-linejoin"].map((k) => a.getAttribute(k)), aKids: a ? a.children.length : 0, b: !!b && b.getAttribute("stroke") };
    const data = await fixture("large-2000.json");
    const expandAll = () => mm.apply(mm.getState().collapsed.map((id) => ({ op: "expand", id })));
    const time = (statuses) => {
      make({ data, view: "right", statuses });
      expandAll();
      const t0 = performance.now(); mm.setFilter(null); return performance.now() - t0;
    };
    const keys = ["open", "pending", "decided", "parked", "blocked", "superseded"];
    window.calls = 0;
    out.plain = time(null);
    out.render = time(Object.fromEntries(keys.map((k) => [k, { render: () => { window.calls++; return L.createElement(L.Check, { width: 12, height: 12 }); } }])));
    out.nodes = document.querySelectorAll("#host .mm-node").length;
    out.calls = window.calls;
    return out;`);
  assert.deepEqual(r.a, ["0 0 24 24", "none", "2", "round", "round"]);
  assert.equal(r.aKids, 2);
  assert.equal(r.b, "currentColor");
  assert.equal(r.nodes, 2000);
  assert.ok(r.calls <= 6 * 4, `render called ${r.calls} times for 2 000 nodes over the draws of this test`);
  console.log(`# browser 2000 nodes, one redraw (right view): built-in shapes ${r.plain.toFixed(0)} ms; every status through render() ${r.render.toFixed(0)} ms (${r.calls} render calls)`);
});
