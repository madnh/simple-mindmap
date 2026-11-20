// Lucide icons through `icon {nodes, stroke: true}`. lucide is a devDependency (npm ci): a missing node_modules makes
// this file FAIL at the import, never skip.
import test from "node:test";
import assert from "node:assert/strict";
import { Check, CircleCheck, KeyRound } from "lucide";
import { statusIcon, toSVG, fakeMeasure, THEME } from "../../src/svg.js";

const draw = (nodes) => statusIcon("x", { x: { label: "X", color: "green", icon: { nodes, stroke: true } } });
const WRAPPER = ['viewBox="0 0 24 24"', 'fill="none"', 'stroke-width="2"', 'stroke-linecap="round"', 'stroke-linejoin="round"', `stroke="${THEME.green}"`];

test("Lucide: Check, CircleCheck and KeyRound (fill=currentColor) draw with the 5 wrapper defaults", () => {
  const check = draw(Check);
  const inner = check.slice(check.indexOf("<svg", 1));
  for (const a of WRAPPER) assert.ok(inner.startsWith("<svg") && inner.split(">")[0].includes(a), `${a} in ${inner}`);
  assert.ok(check.includes(`<path d="${Check[0][1].d}"/>`), check);
  const cc = draw(CircleCheck);
  assert.ok(cc.includes('<circle cx="12" cy="12" r="10"/>'), cc);
  assert.ok(cc.includes(`<path d="${CircleCheck[1][1].d}"/>`), cc);
  const key = draw(KeyRound);
  const dot = KeyRound.find(([t, a]) => t === "circle" && a.fill === "currentColor");
  assert.ok(dot, "KeyRound has a fill=currentColor node");
  assert.ok(key.includes(`<circle cx="${dot[1].cx}" cy="${dot[1].cy}" r="${dot[1].r}" fill="${THEME.green}"/>`), key);
  assert.equal(key.split("currentColor").length - 1, 0);
  // the same icon inside a whole map export
  const map = toSVG({ root: { id: "r", title: "R", children: [{ id: "a", title: "A", status: "x" }] } },
    { statuses: { x: { label: "X", color: "green", icon: { nodes: Check, stroke: true } } }, measure: fakeMeasure });
  assert.ok(map.includes(`<path d="${Check[0][1].d}"/>`));
});
