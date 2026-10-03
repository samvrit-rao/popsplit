import { scoreSplit, targetShares } from "./scoring.ts";
import type { Cut, HalvesCut, QuartersCut, ScreenCell, SplitKind, ThirdsCut } from "./types.ts";

const TAU = Math.PI * 2;

export type Evaluation = {
  pops: number[];
  shares: number[];
  total: number;
  score: number;
  pieceOf: number[];
  labels: string[];
};

export function initialCut(kind: SplitKind): Cut {
  if (kind === "halves") return { kind: "halves", ax: 0.16, ay: 0.5, bx: 0.84, by: 0.5 };
  if (kind === "thirds") {
    return { kind: "thirds", cx: 0.5, cy: 0.5, angles: [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6] };
  }
  return { kind: "quarters", cx: 0.5, cy: 0.5, angle: 0 };
}

export function toPixels(cut: Cut, width: number, height: number): Cut {
  if (cut.kind === "halves") {
    return { kind: "halves", ax: cut.ax * width, ay: cut.ay * height, bx: cut.bx * width, by: cut.by * height };
  }
  if (cut.kind === "thirds") return { kind: "thirds", cx: cut.cx * width, cy: cut.cy * height, angles: [...cut.angles] };
  return { kind: "quarters", cx: cut.cx * width, cy: cut.cy * height, angle: cut.angle };
}

export function evaluate(cells: ScreenCell[], cut: Cut): Evaluation {
  const pieceOf = cells.map((cell) => pieceAt(cell.x, cell.y, cut));
  const pieces = cut.kind === "halves" ? 2 : cut.kind === "thirds" ? 3 : 4;
  const pops = Array.from({ length: pieces }, () => 0);
  for (let i = 0; i < cells.length; i++) pops[pieceOf[i] ?? 0] += cells[i]?.pop ?? 0;
  const total = pops.reduce((sum, value) => sum + value, 0);
  const shares = total > 0 ? pops.map((value) => value / total) : pops.map(() => 0);
  const anchor = cut.kind === "halves" ? null : { x: cut.cx, y: cut.cy };
  return {
    pops,
    shares,
    total,
    score: scoreSplit(shares, targetShares(pieces)),
    pieceOf,
    labels: pieceLabels(cells, pieceOf, pieces, anchor),
  };
}

export function idealCut(cells: ScreenCell[], cut: Cut, viewW = 800, viewH = 600): Cut {
  if (cells.length === 0) return cut;
  if (cut.kind === "halves") return idealHalves(cells, cut);
  if (cut.kind === "thirds") return idealThirds(cells, cut);
  return idealQuarters(cells, cut, viewW, viewH);
}

export function idealCaption(kind: SplitKind): string {
  if (kind === "halves") return "Best parallel slide at the angle you chose.";
  if (kind === "thirds") return "Best swing of the spoke that was furthest off.";
  return "Best small move of this right-angle cross.";
}

function pieceAt(x: number, y: number, cut: Cut): number {
  if (cut.kind === "halves") return halvesSide(x, y, cut);
  if (cut.kind === "thirds") return thirdsSector(x, y, cut);
  return quartersPiece(x, y, cut);
}

function halvesSide(x: number, y: number, cut: HalvesCut): number {
  const cross = (cut.bx - cut.ax) * (y - cut.ay) - (cut.by - cut.ay) * (x - cut.ax);
  return cross >= 0 ? 0 : 1;
}

function thirdsSector(x: number, y: number, cut: ThirdsCut): number {
  return sectorIndex(Math.atan2(y - cut.cy, x - cut.cx), cut.angles);
}

function quartersPiece(x: number, y: number, cut: QuartersCut): number {
  const rel = norm(Math.atan2(y - cut.cy, x - cut.cx) - cut.angle);
  return Math.min(3, Math.floor(rel / (Math.PI / 2)));
}

function sectorIndex(angle: number, spokes: readonly number[]): number {
  const sorted = spokes.map((value) => norm(value)).sort((a, b) => a - b);
  const a = norm(angle);
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i] ?? 0;
    const end = sorted[(i + 1) % sorted.length] ?? start;
    const span = (end - start + TAU) % TAU;
    const rel = (a - start + TAU) % TAU;
    if (rel < span || span === 0) return i;
  }
  return 0;
}

function idealHalves(cells: ScreenCell[], cut: HalvesCut): HalvesCut {
  const dx = cut.bx - cut.ax;
  const dy = cut.by - cut.ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let reach = 1;
  for (const cell of cells) reach = Math.max(reach, Math.abs(cell.x), Math.abs(cell.y));
  const maxOff = reach * 2 + 40;

  const share0 = (offset: number) => {
    let left = 0;
    let right = 0;
    const moved = shiftLine(cut, nx, ny, offset);
    for (const cell of cells) {
      if (halvesSide(cell.x, cell.y, moved) === 0) left += cell.pop;
      else right += cell.pop;
    }
    return left / (left + right || 1);
  };

  const decreasing = share0(maxOff) <= share0(-maxOff);
  let lo = -maxOff;
  let hi = maxOff;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const share = share0(mid);
    if (decreasing) {
      if (share > 0.5) lo = mid;
      else hi = mid;
    } else if (share > 0.5) hi = mid;
    else lo = mid;
  }

  let best = 0;
  let bestErr = Infinity;
  for (const offset of [lo, hi, (lo + hi) / 2]) {
    const err = Math.abs(share0(offset) - 0.5);
    if (err < bestErr) {
      bestErr = err;
      best = offset;
    }
  }
  return shiftLine(cut, nx, ny, best);
}

function shiftLine(cut: HalvesCut, nx: number, ny: number, offset: number): HalvesCut {
  return {
    kind: "halves",
    ax: cut.ax + nx * offset,
    ay: cut.ay + ny * offset,
    bx: cut.bx + nx * offset,
    by: cut.by + ny * offset,
  };
}

function idealThirds(cells: ScreenCell[], cut: ThirdsCut): ThirdsCut {
  const base = evaluate(cells, cut);
  const worst = worstIndex(base.shares);
  const order = cut.angles
    .map((angle, index) => ({ index, angle: norm(angle) }))
    .sort((a, b) => a.angle - b.angle);
  const start = order[worst]?.index ?? 0;
  const end = order[(worst + 1) % order.length]?.index ?? 0;
  const startSlot = worst;
  const endSlot = (worst + 1) % order.length;
  const imbalance = (slot: number) => {
    const left = base.shares[(slot - 1 + order.length) % order.length] ?? 0;
    const right = base.shares[slot] ?? 0;
    return Math.abs(left - right);
  };
  const spoke = imbalance(startSlot) >= imbalance(endSlot) ? start : end;
  const bestAngle = searchSpoke(cells, cut, spoke);
  const angles = [...cut.angles] as [number, number, number];
  angles[spoke] = bestAngle;
  return { kind: "thirds", cx: cut.cx, cy: cut.cy, angles };
}

function searchSpoke(cells: ScreenCell[], cut: ThirdsCut, spoke: number): number {
  const others = cut.angles.filter((_, index) => index !== spoke).map((angle) => norm(angle)).sort((a, b) => a - b);
  const current = norm(cut.angles[spoke] ?? 0);
  const left = others[0] ?? 0;
  const right = others[1] ?? TAU;
  const margin = 0.08;
  let lo: number;
  let hi: number;
  if (current >= left && current <= right) {
    lo = left + margin;
    hi = right - margin;
  } else {
    lo = right + margin;
    hi = left + TAU - margin;
  }
  if (!(hi > lo)) return cut.angles[spoke] ?? current;

  const deviationAt = (angle: number) => {
    const angles = [...cut.angles] as [number, number, number];
    angles[spoke] = angle;
    return deviation(evaluate(cells, { kind: "thirds", cx: cut.cx, cy: cut.cy, angles }).shares, 3);
  };

  let bestAngle = cut.angles[spoke] ?? current;
  let bestDev = deviationAt(bestAngle);
  const steps = 42;
  for (let i = 0; i <= steps; i++) {
    const angle = lo + ((hi - lo) * i) / steps;
    const dev = deviationAt(angle);
    if (dev < bestDev) {
      bestDev = dev;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

function idealQuarters(cells: ScreenCell[], cut: QuartersCut, viewW: number, viewH: number): QuartersCut {
  const scoreOf = (cx: number, cy: number, angle: number) =>
    deviation(evaluate(cells, { kind: "quarters", cx, cy, angle }).shares, 4);

  let best = { cx: cut.cx, cy: cut.cy, angle: cut.angle, dev: scoreOf(cut.cx, cut.cy, cut.angle) };
  for (let i = -12; i <= 12; i++) {
    const angle = cut.angle + (0.5 * i) / 12;
    const dev = scoreOf(cut.cx, cut.cy, angle);
    if (dev < best.dev) best = { cx: cut.cx, cy: cut.cy, angle, dev };
  }

  const stepX = viewW * 0.045;
  const stepY = viewH * 0.045;
  const angled = best;
  for (let ix = -3; ix <= 3; ix++) {
    for (let iy = -3; iy <= 3; iy++) {
      const cx = angled.cx + ix * stepX;
      const cy = angled.cy + iy * stepY;
      if (cx < viewW * 0.12 || cx > viewW * 0.88 || cy < viewH * 0.12 || cy > viewH * 0.88) continue;
      const dev = scoreOf(cx, cy, angled.angle);
      if (dev < best.dev) best = { cx, cy, angle: angled.angle, dev };
    }
  }

  const parked = best;
  for (let i = -6; i <= 6; i++) {
    const angle = parked.angle + i * 0.012;
    const dev = scoreOf(parked.cx, parked.cy, angle);
    if (dev < best.dev) best = { cx: parked.cx, cy: parked.cy, angle, dev };
  }
  return { kind: "quarters", cx: best.cx, cy: best.cy, angle: best.angle };
}

function deviation(shares: number[], pieces: number): number {
  const targets = targetShares(pieces);
  let total = 0;
  for (let i = 0; i < pieces; i++) total += Math.abs((shares[i] ?? 0) - (targets[i] ?? 0));
  return total;
}

function worstIndex(shares: number[]): number {
  let index = 0;
  let worst = -1;
  const target = 1 / Math.max(1, shares.length);
  for (let i = 0; i < shares.length; i++) {
    const err = Math.abs((shares[i] ?? 0) - target);
    if (err > worst) {
      worst = err;
      index = i;
    }
  }
  return index;
}

const COMPASS = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"];

function pieceLabels(
  cells: ScreenCell[],
  pieceOf: number[],
  pieces: number,
  anchor: { x: number; y: number } | null,
): string[] {
  let cx = 0;
  let cy = 0;
  if (anchor) {
    cx = anchor.x;
    cy = anchor.y;
  } else if (cells.length) {
    for (const cell of cells) {
      cx += cell.x;
      cy += cell.y;
    }
    cx /= cells.length;
    cy /= cells.length;
  }

  const names: string[] = [];
  for (let piece = 0; piece < pieces; piece++) {
    let x = 0;
    let y = 0;
    let pop = 0;
    for (let i = 0; i < cells.length; i++) {
      if (pieceOf[i] !== piece) continue;
      const cell = cells[i];
      if (!cell) continue;
      x += cell.x * cell.pop;
      y += cell.y * cell.pop;
      pop += cell.pop;
    }
    if (pop <= 0) {
      names.push("Empty");
      continue;
    }
    names.push(compassName(x / pop - cx, y / pop - cy));
  }

  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((counts.get(name) ?? 0) < 2 || name === "Empty") return name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name} ${n}`;
  });
}

function compassName(dx: number, dy: number): string {
  if (Math.hypot(dx, dy) < 1) return "Center";
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const index = Math.round(((deg + 360) % 360) / 45) % 8;
  return COMPASS[index] ?? "Center";
}

function norm(angle: number): number {
  const value = angle % TAU;
  return value < 0 ? value + TAU : value;
}
