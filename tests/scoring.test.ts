import assert from "node:assert/strict";
import { scoreSplit } from "../src/game/scoring.ts";

const perfectHalves = scoreSplit([0.5, 0.5], [0.5, 0.5]);
const perfectThirds = scoreSplit([1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3]);
const perfectQuarters = scoreSplit([0.25, 0.25, 0.25, 0.25], [0.25, 0.25, 0.25, 0.25]);
const uneven = scoreSplit([1, 0], [0.5, 0.5]);
const lopsided = scoreSplit([0.9, 0.1], [0.5, 0.5]);
const close = scoreSplit([0.55, 0.45], [0.5, 0.5]);
const middling = scoreSplit([0.7, 0.3], [0.5, 0.5]);

assert.equal(perfectHalves, 100, `perfect halves scored ${perfectHalves}`);
assert.equal(perfectThirds, 100, `perfect thirds scored ${perfectThirds}`);
assert.equal(perfectQuarters, 100, `perfect quarters scored ${perfectQuarters}`);
assert.ok(uneven < 15, `all-on-one-side scored ${uneven}`);
assert.ok(lopsided < 30, `90/10 scored ${lopsided}`);
assert.ok(close > middling, `55/45 (${close}) should beat 70/30 (${middling})`);
assert.ok(close > 90, `55/45 should feel near-perfect, scored ${close}`);

console.log(
  `scoring ok  perfect=${perfectHalves}  55/45=${close}  70/30=${middling}  90/10=${lopsided}  100/0=${uneven}`,
);
