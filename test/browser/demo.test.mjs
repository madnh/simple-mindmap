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
    assert.deepEqual(page.console.filter((l) => l.startsWith("EXCEPTION")), []);
    const blocked = await (await fetch(srv.url + "../../etc/passwd")).status;
    assert.notEqual(blocked, 200, "the server does not serve outside the repository");
  } finally { await page.close(); srv.server.close(); }
});
