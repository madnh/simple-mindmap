// The demo page loads through demo/serve.mjs, draws the sample and raises no page error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launch, findChrome } from "./cdp.mjs";
import { startServer } from "../../demo/serve.mjs";

test("demo/index.html draws the sample without errors", { timeout: 60000, skip: findChrome() ? false : "Chrome not found (set CHROME)" }, async () => {
  const srv = await startServer(0);
  const page = await launch();
  try {
    await page.goto(srv.url + "demo/");
    await page.waitFor("document.querySelectorAll('#map .mm-node').length > 3");
    const n = await page.eval("document.querySelectorAll('#map .mm-node').length");
    assert.ok(n > 3);
    await page.eval("document.getElementById('apply').click()");
    assert.match(await page.eval("document.getElementById('result').textContent"), /"ok": true/);
    // status icon panel: mixed levels on the map (path, Lucide icon, URL image, custom element, data: image), legend,
    // live setStatusStyle, theme switch, export levels with fallbacks
    await page.waitFor("document.querySelectorAll('#legend img').length === 6");
    await page.eval(`(() => { const e = document.getElementById("sample"); e.value = "statuses-tones.json"; e.dispatchEvent(new Event("change")); })()`);
    await page.waitFor("document.querySelectorAll('#map .mm-status-render').length > 0");
    const m = await page.eval(`(() => {
      const q = (s) => document.querySelectorAll('#map ' + s).length;
      return { lucide: q(".mm-status svg[viewBox='0 0 24 24']"), image: q(".mm-status image"), element: q(".mm-status-render demo-badge"), icon: q(".mm-status svg path[d='M6 1L11 6L6 11L1 6Z']") };
    })()`);
    for (const [k, v] of Object.entries(m)) assert.ok(v > 0, `${k} drawn (${v})`);
    await page.eval(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("change")); };
      set("styleKey", "open"); set("styleColor", "red"); set("styleIcon", "hand"); document.getElementById("styleApply").click(); })()`);
    assert.equal(await page.eval("document.getElementById('styleResult').textContent"), '{"ok":true}');
    await page.eval(`(() => { const e = document.getElementById("theme"); e.value = "custom"; e.dispatchEvent(new Event("change")); })()`);
    assert.match(await page.eval("document.getElementById('result').textContent"), /setTheme -> true/);
    assert.equal(await page.eval("document.querySelector('#map .simple-mindmap').style.getPropertyValue('--mm-bg')"), "#fbf7ef");
    await page.eval("window.URL.createObjectURL = () => 'blob:x'; HTMLAnchorElement.prototype.click = () => {}; document.querySelector('[data-export=svg]').click()");
    const lv = await page.eval("document.getElementById('levels').textContent");
    assert.match(lv, /parked: map image, export symbol \(fell back\)/);
    assert.match(lv, /blocked: map render, export symbol \(fell back\)/);
    assert.match(lv, /superseded: map image, export image$/m);
    assert.deepEqual(page.console.filter((l) => l.startsWith("EXCEPTION")), []);
    const blocked = await (await fetch(srv.url + "../../etc/passwd")).status;
    assert.notEqual(blocked, 200, "the server does not serve outside the repository");
  } finally {
    try { await page.close(); } finally { srv.server.closeAllConnections(); srv.server.close(); }
  }
});
