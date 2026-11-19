// The demo / test server must never serve a file outside its root, however the path is encoded.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:http";
import { startServer } from "../../demo/serve.mjs";

const SECRET = "OUTSIDE-SECRET";
const fetchRaw = (port, path) => new Promise((ok, bad) => {
  get({ host: "127.0.0.1", port, path }, (res) => { let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => ok({ status: res.statusCode, body })); }).on("error", bad);
});

test("demo server: encoded traversal, dotfiles and symlinks out of the root are refused", async () => {
  const top = mkdtempSync(join(tmpdir(), "smm-serve-"));
  const root = join(top, "site");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(join(top, "site-sibling"));
  writeFileSync(join(root, "a.txt"), "A");
  writeFileSync(join(root, "sub", "b.txt"), "B");
  writeFileSync(join(root, ".secret"), SECRET);
  writeFileSync(join(top, "outside.txt"), SECRET);
  writeFileSync(join(top, "site-sibling", "x.txt"), SECRET);
  symlinkSync(join(top, "outside.txt"), join(root, "link-out"));
  symlinkSync(join(top, "site-sibling"), join(root, "dir-out"));
  symlinkSync(join(root, "a.txt"), join(root, "link-in"));
  const srv = await startServer(0, { root });
  try {
    const cases = {
      "/a.txt": 200, "/sub/b.txt": 200, "/link-in": 200,
      "/..%2foutside.txt": 403, "/%2e%2e%2foutside.txt": 403, "/..%5coutside.txt": 403, "/%2E%2E%5Coutside.txt": 403,
      "/sub%2f..%2f..%2foutside.txt": 403, "/sub/..%2f..%2foutside.txt": 403,
      "/..%2fsite-sibling/x.txt": 403, "/..%2fsite-sibling%2fx.txt": 403,
      "/%252e%252e%252foutside.txt": 404, // double-encoded: decoded once, it is a plain (missing) name
      "/link-out": 403, "/dir-out/x.txt": 403, "/.secret": 403, "/sub/%2esecret": 403, "/a.txt%00": 403, "/%": 403,
      "/missing.txt": 404,
    };
    const got = {};
    for (const p of Object.keys(cases)) {
      const r = await fetchRaw(srv.port, p);
      got[p] = r.status;
      assert.ok(!r.body.includes(SECRET), `${p} leaked a file outside the root`);
    }
    assert.deepEqual(got, cases);
  } finally {
    srv.server.close();
    rmSync(top, { recursive: true, force: true });
  }
});

test("demo server: the repository is served, its parent is not reachable through it", async () => {
  const repo = basename(fileURLToPath(new URL("../../", import.meta.url)));
  const srv = await startServer(0);
  try {
    assert.equal((await fetchRaw(srv.port, "/LICENSE")).status, 200);
    assert.equal((await fetchRaw(srv.port, `/..%2f${repo}/LICENSE`)).status, 403);
    assert.equal((await fetchRaw(srv.port, "/.git/HEAD")).status, 403);
  } finally { srv.server.close(); }
});
