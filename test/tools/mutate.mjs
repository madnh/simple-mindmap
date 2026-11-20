// Mutation runner. Copies the repository once (with node_modules: the Lucide tests and the demo need the devDependency)
// to a temporary directory; for each mutation in mutations.mjs it applies the edit there, runs the suite, checks that
// the named test failed, and writes the edited files back. The working tree is never touched.
// After each mutation the runner compares the sha256 of every edited file with the original and aborts the whole run
// (exit 3, "RESTORE FAILED") on a mismatch. Every run first proves that abort fires: it runs itself once with
// --sabotage-restore (a test hook that writes a wrong byte back) and requires exit 3 (else exit 4, "SELF-CHECK FAILED").
// Usage: node test/tools/mutate.mjs [--suite unit|browser] [--only M01,M02] [--no-self-check]
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MUTATIONS } from "./mutations.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const suite = arg("--suite");
const list = MUTATIONS.filter((m) => (!only || only.has(m.id)) && (!suite || m.suite === suite));
const sabotage = process.argv.includes("--sabotage-restore");
const sha = (s) => createHash("sha256").update(s).digest("hex");

if (!sabotage && !process.argv.includes("--no-self-check")) {
  const self = fileURLToPath(import.meta.url);
  const r = spawnSync(process.execPath, [self, "--suite", "unit", "--only", "M39", "--sabotage-restore"], { encoding: "utf8", timeout: 300000 });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 3 || !out.includes("M39 RESTORE FAILED")) {
    console.log(`SELF-CHECK FAILED: a broken restore must abort with exit 3, got exit ${r.status}\n${out}`);
    process.exit(4);
  }
  console.log("self-check: a broken restore aborts the run (exit 3)");
}

function run(dir, which) {
  const files = which === "browser" ? ["test/unit/", "test/browser/interaction.test.mjs"] : ["test/unit/"];
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec", ...files], { cwd: dir, encoding: "utf8", timeout: 300000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// baseline: the unmutated copy must be green, otherwise every "red" below means nothing
const base = mkdtempSync(join(tmpdir(), "smm-mut-"));
cpSync(ROOT, base, { recursive: true, filter: (p) => !p.includes("/.git") });
const needBrowser = list.some((m) => m.suite === "browser");
const b = run(base, needBrowser ? "browser" : "unit");
console.log(`baseline (${needBrowser ? "unit + browser" : "unit"}): ${b.code === 0 ? "green" : "RED"}`);
if (b.code !== 0) { console.log(b.out.split("\n").filter((l) => l.startsWith("✖")).join("\n")); rmSync(base, { recursive: true, force: true }); process.exit(2); }

let red = 0, survived = 0, notApplied = 0;
for (const m of list) {
  const dir = base;
  const original = new Map(); // file -> content before this mutation (its sha256 is what restore must reproduce)
  let applied = true;
  for (const [file, find, replace] of m.edits) {
    const p = join(dir, file);
    const src = readFileSync(p, "utf8");
    if (!original.has(p)) original.set(p, src);
    const n = src.split(find).length - 1;
    if (n !== 1) { applied = false; console.log(`${m.id} NOT APPLIED: "${find.slice(0, 60)}" found ${n} times in ${file}`); break; }
    writeFileSync(p, src.replace(find, () => replace));
  }
  // Writes the edited files back; the sha256 of each must equal the original, or the run stops: every later mutation
  // must start from clean code.
  const restore = () => {
    for (const [p, src] of original) {
      writeFileSync(p, sabotage ? src + "\n" : src);
      const got = sha(readFileSync(p)), want = sha(Buffer.from(src, "utf8"));
      if (got !== want) {
        console.log(`${m.id} RESTORE FAILED: ${p.slice(dir.length)} sha256 ${got.slice(0, 12)} != original ${want.slice(0, 12)}`);
        rmSync(base, { recursive: true, force: true });
        process.exit(3);
      }
    }
  };
  if (!applied) { notApplied++; restore(); continue; }
  const r = run(dir, m.suite);
  const failed = r.out.split("\n").filter((l) => /^\s*✖ /.test(l) && !/failing tests/.test(l)).map((l) => l.trim().slice(2));
  const hit = failed.some((name) => name.includes(m.expect));
  if (r.code !== 0 && hit) { red++; console.log(`${m.id} red      ${m.what}  ->  "${failed.find((n) => n.includes(m.expect)).replace(/ \([\d.]+ms\)$/, "")}" (+${new Set(failed).size - 1} more)`); }
  else { survived++; console.log(`${m.id} SURVIVED ${m.what}  (exit ${r.code}; failed: ${[...new Set(failed)].join(" | ") || "none"})`); }
  restore();
}
rmSync(base, { recursive: true, force: true });
console.log(`mutations: ${list.length} total, ${red} red, ${survived} survived, ${notApplied} not applied`);
process.exit(survived || notApplied ? 1 : 0);
