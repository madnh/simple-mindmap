// Zero-dependency static server for the demo and the browser tests (browsers refuse ES module
// imports from file:// pages). Binds 127.0.0.1 only. Usage: node demo/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, stat, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, resolve, sep } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8" };

// Maps a request path to a file inside `base`, or returns null (refused). The path is decoded once; every segment
// (split on "/" and "\\") must be a plain name: no "", ".", "..", dotfiles or NUL. The real path (symlinks
// resolved) must then still be inside `base`.
export async function resolveRequest(base, rawPath) {
  let path;
  try { path = decodeURIComponent(rawPath); } catch { return null; }
  if (path.endsWith("/")) path += "index.html";
  const parts = path.split(/[\\/]/).slice(1);
  if (!parts.length || parts.some((p) => p === "" || p.startsWith(".") || p.includes("\0"))) return null;
  let real;
  try { real = await realpath(resolve(base, ...parts)); } catch { return undefined; } // undefined: not found
  if (!real.startsWith(base + sep)) return null;
  return real;
}

export async function startServer(port = 0, { root = ROOT } = {}) {
  const base = (await realpath(root)).replace(/[\\/]+$/, "");
  const server = createServer(async (req, res) => {
    try {
      const file = await resolveRequest(base, new URL(req.url, "http://x").pathname);
      if (file === null) { res.writeHead(403).end(); return; }
      if (file === undefined) { res.writeHead(404).end(); return; }
      const st = await stat(file);
      if (!st.isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await startServer(Number(process.argv[2] || process.env.PORT || 8765));
  console.log(`simple-mindmap demo: ${url}demo/`);
}
