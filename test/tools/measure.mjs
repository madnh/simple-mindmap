// Layout measurements: trees of 400 and 2 000 nodes, each view, fake text measure (grapheme count x constant).
// Prints the overlap count (must be 0) and the layout time (median of 7 runs). Exit 1 if any overlap.
import { validate } from "../../src/core.js";
import { layout, overlaps } from "../../src/layout.js";
import { fakeMeasure } from "../../src/svg.js";
import { randomTree } from "../helpers.mjs";

let bad = 0;
console.log("nodes  seed  view     drawn  overlaps  layout_ms(median of 7)");
for (const n of [400, 2000]) {
  for (const seed of [1, 2, 3]) {
    const data = validate({ root: randomTree(n, seed) }).data;
    for (const view of ["both", "right", "outline"]) {
      const times = [];
      let lay;
      for (let i = 0; i < 7; i++) { const t0 = performance.now(); lay = layout(data, { view, measure: fakeMeasure }); times.push(performance.now() - t0); }
      times.sort((a, b) => a - b);
      const ov = overlaps(lay.boxes);
      if (ov || lay.boxes.size !== n) bad++;
      console.log(`${String(n).padEnd(6)} ${String(seed).padEnd(5)} ${view.padEnd(8)} ${String(lay.boxes.size).padEnd(6)} ${String(ov).padEnd(9)} ${times[3].toFixed(2)}`);
    }
  }
}
console.log(bad ? `FAIL: ${bad} layouts with overlaps or missing nodes` : "OK: 0 overlapping box pairs in every layout");
process.exit(bad ? 1 : 0);
