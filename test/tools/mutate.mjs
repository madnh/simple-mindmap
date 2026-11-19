// Mutation runner. For each mutation in mutations.mjs: copy the repository to a temporary directory, apply the edit
// there (the working tree is never touched), run the suite, and check that the named test failed.
// Usage: node test/tools/mutate.mjs [--suite unit|browser] [--only M01,M02]
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MUTATIONS } from "./mutations.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const suite = arg("--suite");
const list = MUTATIONS.filter((m) => (!only || only.has(m.id)) && (!suite || m.suite === suite));

function run(dir, which) {
  const files = which === "browser" ? ["test/unit/", "test/browser/interaction.test.mjs"] : ["test/unit/"];
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec", ...files], { cwd: dir, encoding: "utf8", timeout: 300000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// baseline: the unmutated copy must be green, otherwise every "red" below means nothing
const base = mkdtempSync(join(tmpdir(), "smm-mut-"));
cpSync(ROOT, base, { recursive: true, filter: (p) => !p.includes("/.git") && !p.includes("node_modules") });
const needBrowser = list.some((m) => m.suite === "browser");
const b = run(base, needBrowser ? "browser" : "unit");
console.log(`baseline (${needBrowser ? "unit + browser" : "unit"}): ${b.code === 0 ? "green" : "RED"}`);
if (b.code !== 0) { console.log(b.out.split("\n").filter((l) => l.startsWith("✖")).join("\n")); rmSync(base, { recursive: true, force: true }); process.exit(2); }

let red = 0, survived = 0, notApplied = 0;
for (const m of list) {
  const dir = mkdtempSync(join(tmpdir(), "smm-mut-"));
  cpSync(base, dir, { recursive: true });
  let applied = true;
  for (const [file, find, replace] of m.edits) {
    const p = join(dir, file);
    const src = readFileSync(p, "utf8");
    const n = src.split(find).length - 1;
    if (n !== 1) { applied = false; console.log(`${m.id} NOT APPLIED: "${find.slice(0, 60)}" found ${n} times in ${file}`); break; }
    writeFileSync(p, src.replace(find, () => replace));
  }
  if (!applied) { notApplied++; rmSync(dir, { recursive: true, force: true }); continue; }
  const r = run(dir, m.suite);
  const failed = r.out.split("\n").filter((l) => /^\s*✖ /.test(l) && !/failing tests/.test(l)).map((l) => l.trim().slice(2));
  const hit = failed.some((name) => name.includes(m.expect));
  if (r.code !== 0 && hit) { red++; console.log(`${m.id} red      ${m.what}  ->  "${failed.find((n) => n.includes(m.expect)).replace(/ \([\d.]+ms\)$/, "")}" (+${new Set(failed).size - 1} more)`); }
  else { survived++; console.log(`${m.id} SURVIVED ${m.what}  (exit ${r.code}; failed: ${[...new Set(failed)].join(" | ") || "none"})`); }
  rmSync(dir, { recursive: true, force: true });
}
rmSync(base, { recursive: true, force: true });
console.log(`mutations: ${list.length} total, ${red} red, ${survived} survived, ${notApplied} not applied`);
process.exit(survived || notApplied ? 1 : 0);
