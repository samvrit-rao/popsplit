import assert from "node:assert/strict";
import { evaluate, idealCut } from "../src/game/evaluate.ts";
import type { ScreenCell } from "../src/game/types.ts";

const row: ScreenCell[] = [
  { x: 0, y: 0, pop: 10 },
  { x: 10, y: 0, pop: 10 },
  { x: 20, y: 0, pop: 10 },
  { x: 30, y: 0, pop: 10 },
];

const lopsided = evaluate(row, { kind: "halves", ax: 5, ay: -10, bx: 5, by: 10 });
assert.ok(Math.abs((lopsided.shares[0] ?? 0) - 0.25) < 1e-9, "one of four cells should be 25%");
assert.ok(lopsided.score < 80, `lopsided score ${lopsided.score}`);

const ideal = idealCut(row, { kind: "halves", ax: 5, ay: -10, bx: 5, by: 10 }, 40, 20);
const balanced = evaluate(row, ideal);
assert.equal(ideal.kind, "halves");
assert.ok(Math.abs((balanced.shares[0] ?? 0) - 0.5) < 0.02, `ideal share ${balanced.shares[0]}`);
assert.ok(balanced.score >= 99, `ideal halves scored ${balanced.score}`);
if (ideal.kind === "halves") {
  const slope = (ideal.by - ideal.ay) / ((ideal.bx - ideal.ax) || 1);
  assert.ok(Math.abs(slope) > 20 || Math.abs(ideal.bx - ideal.ax) < 1e-6, "ideal move stays vertical");
}

const evenLine = evaluate(row, { kind: "halves", ax: 15, ay: -10, bx: 15, by: 10 });
assert.equal(evenLine.score, 100);

const thirds = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((angle) => ({
  x: Math.cos(angle + Math.PI / 3) * 10,
  y: Math.sin(angle + Math.PI / 3) * 10,
  pop: 10,
}));
const thirdCut = { kind: "thirds" as const, cx: 0, cy: 0, angles: [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3] as [number, number, number] };
const thirdScore = evaluate(thirds, thirdCut);
assert.equal(thirdScore.score, 100, `thirds perfect scored ${thirdScore.score} shares ${thirdScore.shares}`);

const unevenPoints = [
  { x: 10, y: 0, pop: 30 },
  { x: -5, y: 8, pop: 5 },
  { x: -5, y: -8, pop: 5 },
];
const unevenThirds = evaluate(unevenPoints, thirdCut);
const betterThirds = evaluate(unevenPoints, idealCut(unevenPoints, thirdCut));
assert.ok(betterThirds.score >= unevenThirds.score, "thirds ideal should not get worse");

const quarters = [
  { x: 10, y: 10, pop: 8 },
  { x: -10, y: 10, pop: 8 },
  { x: -10, y: -10, pop: 8 },
  { x: 10, y: -10, pop: 8 },
];
const quarterCut = { kind: "quarters" as const, cx: 0, cy: 0, angle: 0 };
const quarterScore = evaluate(quarters, quarterCut);
assert.equal(quarterScore.score, 100, `quarters perfect scored ${quarterScore.score} shares ${quarterScore.shares}`);

const shifted = evaluate(quarters, { kind: "quarters", cx: 6, cy: 0, angle: 0.4 });
const fixed = evaluate(quarters, idealCut(quarters, { kind: "quarters", cx: 6, cy: 0, angle: 0.4 }, 40, 40));
assert.ok(fixed.score >= shifted.score, "quarters local search should not get worse");

console.log(
  `evaluate ok  lopsided=${lopsided.score}  idealHalves=${balanced.score}  thirds=${thirdScore.score}  quarters=${quarterScore.score}  quarterFix=${shifted.score}->${fixed.score}`,
);
