// Copies src/mindmap.css into the CSS constant of src/mindmap.js (the component injects it once per document).
// `node test/tools/sync-css.mjs --check` exits 1 when they differ.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const css = readFileSync(root + "src/mindmap.css", "utf8");
const jsPath = root + "src/mindmap.js";
const js = readFileSync(jsPath, "utf8");
const re = /\/\*CSS-BEGIN\*\/[\s\S]*?\/\*CSS-END\*\//;
if (!re.test(js)) { console.error("CSS markers not found in src/mindmap.js"); process.exit(2); }
const next = js.replace(re, () => `/*CSS-BEGIN*/export const CSS = ${JSON.stringify(css)};/*CSS-END*/`);
if (process.argv.includes("--check")) {
  if (next !== js) { console.error("src/mindmap.js CSS differs from src/mindmap.css: run npm run sync-css"); process.exit(1); }
  console.log("css in sync");
} else { writeFileSync(jsPath, next); console.log(next === js ? "css unchanged" : "css synced"); }
