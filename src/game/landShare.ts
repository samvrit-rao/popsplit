import { geoContains } from "d3-geo";
import { boundsOfGeometry, lonSpanOf } from "./bounds.ts";
import { inBBox } from "./population.ts";
import type { BBox, Cell, GeoCollection, GeoFeature } from "./types.ts";

/** Water has to stay a minority of the play frame. */
export const MIN_LAND_SHARE = 0.55;

const COLS = 18;
const ROWS = 16;

type Sample = {
  hit: boolean[][];
  cols: number;
  rows: number;
  hits: number;
  box: BBox;
};

export type LandFrame = { box: BBox; land: number };

/**
 * Share of the frame that falls on land. 1 means the sample is entirely inland.
 */
export function landFraction(shape: GeoFeature | GeoCollection, box: BBox): number {
  const sample = sampleLand(shape, box);
  if (!sample || sample.cols * sample.rows === 0) return 0;
  return sample.hits / (sample.cols * sample.rows);
}

/**
 * True when a wet band runs through the frame with land on both sides:
 * a gulf, a lake, or open water between two coasts. Water along one edge
 * is a coastline and does not count.
 */
export function hasMiddleWater(shape: GeoFeature | GeoCollection, box: BBox): boolean {
  const sample = sampleLand(shape, box);
  if (!sample) return false;
  if (narrowChannel(sample) || hasBay(sample)) return true;
  const labeled = labelComponents(sample);
  const parts = labeled.parts.filter((part) => part.hits >= 4);
  if (parts.length < 2) return false;
  const biggest = Math.max(...parts.map((part) => part.hits));
  const rivals = parts.filter((part) => part.hits >= Math.max(4, biggest * 0.08));
  if (rivals.length < 2) return false;
  const chosen = rivals.reduce((best, part) => (part.hits > best.hits ? part : best));
  return rivals.some((part) => part.id !== chosen.id && minDistance(labeled.labels, chosen.id, part.id) >= 3);
}

/**
 * Shrink `box` until the frame is mostly land and water is not the middle.
 * Returns null when the geometry misses the box entirely. The box only shrinks.
 */
export function solidLandFrame(
  shape: GeoFeature | GeoCollection,
  box: BBox,
  cells?: Cell[],
): LandFrame | null {
  let active: GeoFeature | GeoCollection = shape;
  let current = box;
  let best: LandFrame | null = null;
  let triedPiece = false;
  for (let pass = 0; pass < 7; pass++) {
    const sample = sampleLand(active, current);
    if (!sample || sample.hits === 0) {
      if (triedPiece) break;
      const piece = largestPiece(active);
      const pieceBox = piece ? boundsOfGeometry(piece) : null;
      if (!piece || !pieceBox || sameBox(pieceBox, current)) break;
      active = piece;
      current = pieceBox;
      triedPiece = true;
      continue;
    }
    const land = sample.hits / (sample.cols * sample.rows);
    const split = splitFrame(current, sample, cells, pass === 0);
    if (split && !sameBox(split, current)) {
      current = split;
      continue;
    }
    if (!triedPiece && land < 0.25) {
      const piece = largestPiece(active);
      const pieceBox = piece ? boundsOfGeometry(piece) : null;
      if (piece && pieceBox && keepsPeople(cells, pieceBox) && lonSpanOf(pieceBox) >= 0.4 && areaOf(pieceBox) < areaOf(current) * 0.85) {
        active = piece;
        current = pieceBox;
        triedPiece = true;
        continue;
      }
    }
    const peeled = peelOpenWater(current, sample);
    if (peeled && keepsPeople(cells, peeled) && !sameBox(peeled, current)) {
      current = peeled;
      continue;
    }
    if (keepsPeople(cells, current) && (!best || land > best.land + 0.02 || (land >= best.land - 0.02 && areaOf(current) > areaOf(best.box)))) {
      best = { box: current, land };
    }
    if (land >= MIN_LAND_SHARE) return { box: current, land };
    const next = tighten(current, sample, cells);
    if (next && !sameBox(next, current)) {
      current = next;
      continue;
    }
    break;
  }
  return best;
}

/**
 * Two separated coasts become the landmass with more people. A narrow gulf
 * or lake still splits one polygon. Open water along a single edge does not.
 */
function splitFrame(box: BBox, sample: Sample, cells: Cell[] | undefined, allowBay: boolean): BBox | null {
  if (allowBay) {
    const bay = bayCut(box, sample, cells);
    if (bay && !sameBox(bay, box)) return bay;
  }
  const landmass = dominantLandmass(sample, box, cells);
  if (landmass && !sameBox(landmass, box)) return landmass;
  const gap = narrowChannel(sample);
  if (!gap) return null;
  return cutGap(box, sample, gap, cells);
}

/**
 * A bay or gulf can leave the two shores connected at one end, so they are
 * a single landmass with water in the middle. Cut along the middle of that
 * water and keep the shore that holds the cities.
 */
function hasBay(sample: Sample): boolean {
  const vertical = interiorRuns(sample, "col").length >= Math.max(3, Math.ceil(sample.rows * 0.22));
  const horizontal = interiorRuns(sample, "row").length >= Math.max(3, Math.ceil(sample.cols * 0.22));
  return vertical || horizontal;
}

function bayCut(box: BBox, sample: Sample, cells?: Cell[]): BBox | null {
  const vertical = baySide(box, sample, cells, "col", interiorRuns(sample, "col"));
  const horizontal = baySide(box, sample, cells, "row", interiorRuns(sample, "row"));
  if (vertical && horizontal) {
    return areaOf(vertical) >= areaOf(horizontal) ? vertical : horizontal;
  }
  return vertical ?? horizontal;
}

function baySide(
  box: BBox,
  sample: Sample,
  cells: Cell[] | undefined,
  axis: "col" | "row",
  runs: Array<{ start: number; end: number }>,
): BBox | null {
  const length = axis === "col" ? sample.cols : sample.rows;
  const lines = axis === "col" ? sample.rows : sample.cols;
  if (runs.length < Math.max(3, Math.ceil(lines * 0.22))) return null;
  const centers = runs.map((run) => (run.start + run.end) / 2).sort((a, b) => a - b);
  const spread = (centers[centers.length - 1] ?? 0) - (centers[0] ?? 0);
  if (spread > length * 0.75) return null;
  const mid = centers[Math.floor(centers.length / 2)] ?? length / 2;
  const cut = Math.max(2, Math.min(length - 2, Math.round(mid)));
  const cols = sample.cols;
  const rows = sample.rows;
  const left = axis === "col"
    ? { box: boxFromSamples(box, 0, cut, 0, rows, cols, rows), hits: sideHits(sample, axis, 0, cut) }
    : { box: boxFromSamples(box, 0, cols, 0, cut, cols, rows), hits: sideHits(sample, axis, 0, cut) };
  const right = axis === "col"
    ? { box: boxFromSamples(box, cut, cols, 0, rows, cols, rows), hits: sideHits(sample, axis, cut, length) }
    : { box: boxFromSamples(box, 0, cols, cut, rows, cols, rows), hits: sideHits(sample, axis, cut, length) };
  const choices = [left, right].filter((part) => part.hits >= sample.hits * 0.28 && keepsPeople(cells, part.box));
  if (!choices.length) return null;
  choices.sort((a, b) => populationIn(cells, b.box) - populationIn(cells, a.box) || b.hits - a.hits);
  return choices[0]?.box ?? null;
}

function dominantLandmass(sample: Sample, box: BBox, cells?: Cell[]): BBox | null {
  const labeled = labelComponents(sample);
  const parts = labeled.parts.filter((part) => part.hits >= 4);
  if (parts.length < 2) return null;
  const biggest = Math.max(...parts.map((part) => part.hits));
  const rivals = parts.filter((part) => part.hits >= Math.max(4, biggest * 0.08));
  if (rivals.length < 2) return null;
  rivals.sort((a, b) => scoreLandmass(b, sample, box, cells) - scoreLandmass(a, sample, box, cells));
  const chosen = rivals[0]!;
  const far = rivals.filter((part) => part.id !== chosen.id && minDistance(labeled.labels, chosen.id, part.id) >= 3);
  if (!far.length) return null;
  const clear = largestClear(sample, box, cells, labeled.labels, chosen.id, far.map((part) => part.id));
  if (clear) return clear;
  return boxFromSamples(box, chosen.minC, chosen.maxC + 1, chosen.minR, chosen.maxR + 1, sample.cols, sample.rows);
}

function largestClear(
  sample: Sample,
  box: BBox,
  cells: Cell[] | undefined,
  labels: number[][],
  chosenId: number,
  rivalIds: number[],
): BBox | null {
  const rival = new Set(rivalIds.filter((id) => id !== chosenId));
  if (!rival.size) return null;
  const cols = sample.cols;
  const rows = sample.rows;
  const chosenPrefix = prefixSums(labels.map((row) => row.map((id) => id === chosenId)));
  const rivalPrefix = prefixSums(labels.map((row) => row.map((id) => rival.has(id))));
  let best: { hits: number; area: number; pop: number; c0: number; c1: number; r0: number; r1: number } | null = null;
  for (let c0 = 0; c0 < cols; c0++) {
    for (let c1 = c0 + 2; c1 <= cols; c1++) {
      for (let r0 = 0; r0 < rows; r0++) {
        for (let r1 = r0 + 2; r1 <= rows; r1++) {
          if (rectHits(rivalPrefix, c0, r0, c1, r1) > 0) continue;
          const hits = rectHits(chosenPrefix, c0, r0, c1, r1);
          const total = (c1 - c0) * (r1 - r0);
          if (hits < 6 || hits / total < MIN_LAND_SHARE) continue;
          const part = boxFromSamples(box, c0, c1, r0, r1, cols, rows);
          if (!keepsPeople(cells, part)) continue;
          const candidate = { hits, area: areaOf(part), pop: populationIn(cells, part), c0, c1, r0, r1 };
          if (!best || candidate.hits > best.hits * 1.1 || (candidate.hits >= best.hits * 0.9 && candidate.pop > best.pop) || (candidate.hits >= best.hits * 0.9 && candidate.pop === best.pop && candidate.area > best.area)) {
            best = candidate;
          }
        }
      }
    }
  }
  if (!best) return null;
  return boxFromSamples(box, best.c0, best.c1, best.r0, best.r1, cols, rows);
}

function scoreLandmass(part: Component, sample: Sample, box: BBox, cells?: Cell[]): number {
  const framed = boxFromSamples(box, part.minC, part.maxC + 1, part.minR, part.maxR + 1, sample.cols, sample.rows);
  const count = cells ? cells.filter((cell) => inBBox(cell.lon, cell.lat, framed)).length : 0;
  const pop = populationIn(cells, framed);
  return count > 0 ? pop + part.hits : part.hits;
}

type Component = { hits: number; minC: number; maxC: number; minR: number; maxR: number };

function labelComponents(sample: Sample): { labels: number[][]; parts: Array<Component & { id: number }> } {
  const labels = Array.from({ length: sample.rows }, () => new Array<number>(sample.cols).fill(0));
  const parts: Array<Component & { id: number }> = [];
  let nextId = 1;
  for (let r = 0; r < sample.rows; r++) {
    for (let c = 0; c < sample.cols; c++) {
      if (!sample.hit[r]?.[c] || labels[r]?.[c]) continue;
      const id = nextId++;
      let hits = 0;
      let minC = c;
      let maxC = c;
      let minR = r;
      let maxR = r;
      const stack: Array<[number, number]> = [[r, c]];
      labels[r]![c] = id;
      while (stack.length) {
        const next = stack.pop();
        if (!next) break;
        const [cr, cc] = next;
        hits++;
        minC = Math.min(minC, cc);
        maxC = Math.max(maxC, cc);
        minR = Math.min(minR, cr);
        maxR = Math.max(maxR, cr);
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr < 0 || nc < 0 || nr >= sample.rows || nc >= sample.cols) continue;
            if (labels[nr]?.[nc] || !sample.hit[nr]?.[nc]) continue;
            labels[nr]![nc] = id;
            stack.push([nr, nc]);
          }
        }
      }
      parts.push({ id, hits, minC, maxC, minR, maxR });
    }
  }
  return { labels, parts };
}

function minDistance(labels: number[][], a: number, b: number): number {
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let r = 0; r < labels.length; r++) {
    const row = labels[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === a) left.push([r, c]);
      else if (row[c] === b) right.push([r, c]);
    }
  }
  let best = 99;
  for (const [ar, ac] of left) {
    for (const [br, bc] of right) {
      const distance = Math.max(Math.abs(ar - br), Math.abs(ac - bc));
      if (distance < best) best = distance;
      if (best <= 2) return best;
    }
  }
  return best;
}

function narrowChannel(sample: Sample): { axis: "col" | "row"; start: number; end: number } | null {
  const vertical = tightBand(sample, "col");
  const horizontal = tightBand(sample, "row");
  if (vertical && horizontal) return vertical.strength >= horizontal.strength ? vertical : horizontal;
  return vertical ?? horizontal;
}

function tightBand(sample: Sample, axis: "col" | "row"): { axis: "col" | "row"; start: number; end: number; strength: number } | null {
  const band = gulfBand(sample, axis);
  if (!band) return null;
  const length = axis === "col" ? sample.cols : sample.rows;
  const width = band.end - band.start;
  if (width < 2 || width > length * 0.42) return null;
  const left = sideHits(sample, axis, 0, band.start);
  const right = sideHits(sample, axis, band.end, length);
  if (left < sample.hits * 0.18 || right < sample.hits * 0.18) return null;
  return band;
}

function sideHits(sample: Sample, axis: "col" | "row", start: number, end: number): number {
  let hits = 0;
  if (axis === "col") {
    for (let r = 0; r < sample.rows; r++) {
      for (let c = start; c < end; c++) if (sample.hit[r]?.[c]) hits++;
    }
  } else {
    for (let r = start; r < end; r++) {
      for (let c = 0; c < sample.cols; c++) if (sample.hit[r]?.[c]) hits++;
    }
  }
  return hits;
}

function gulfBand(sample: Sample, axis: "col" | "row"): { axis: "col" | "row"; start: number; end: number; strength: number } | null {
  const runs = interiorRuns(sample, axis);
  const length = axis === "col" ? sample.cols : sample.rows;
  const lines = axis === "col" ? sample.rows : sample.cols;
  const span = axis === "col" ? lonSpanOf(sample.box) : sample.box.north - sample.box.south;
  const cover = new Array<number>(length).fill(0);
  for (const run of runs) {
    for (let index = run.start; index < run.end; index++) cover[index] = (cover[index] ?? 0) + 1;
  }
  const need = Math.max(3, Math.ceil(lines * 0.2));
  let best: { axis: "col" | "row"; start: number; end: number; strength: number } | null = null;
  let index = 0;
  while (index < length) {
    if ((cover[index] ?? 0) < need) {
      index++;
      continue;
    }
    const start = index;
    let strength = 0;
    while (index < length && (cover[index] ?? 0) >= need) {
      strength += cover[index] ?? 0;
      index++;
    }
    const end = index;
    const gapDeg = ((end - start) / length) * span;
    if (end - start < 2 || gapDeg < 0.8) continue;
    if (!best || strength > best.strength) best = { axis, start, end, strength };
  }
  return best;
}

function interiorRuns(sample: Sample, axis: "col" | "row"): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  const outer = axis === "col" ? sample.rows : sample.cols;
  const inner = axis === "col" ? sample.cols : sample.rows;
  for (let line = 0; line < outer; line++) {
    let index = 0;
    let seenLand = false;
    while (index < inner) {
      while (index < inner && !occupied(sample, axis, line, index)) index++;
      if (index >= inner) break;
      seenLand = true;
      while (index < inner && occupied(sample, axis, line, index)) index++;
      const waterStart = index;
      while (index < inner && !occupied(sample, axis, line, index)) index++;
      if (seenLand && index < inner && index > waterStart) runs.push({ start: waterStart, end: index });
    }
  }
  return runs;
}

function occupied(sample: Sample, axis: "col" | "row", line: number, index: number): boolean {
  return axis === "col" ? !!sample.hit[line]?.[index] : !!sample.hit[index]?.[line];
}

function cutGap(box: BBox, sample: Sample, gap: { axis: "col" | "row"; start: number; end: number }, cells?: Cell[]): BBox | null {
  const cols = sample.cols;
  const rows = sample.rows;
  const left = gap.axis === "col"
    ? { c0: 0, c1: gap.start, r0: 0, r1: rows }
    : { c0: 0, c1: cols, r0: 0, r1: gap.start };
  const right = gap.axis === "col"
    ? { c0: gap.end, c1: cols, r0: 0, r1: rows }
    : { c0: 0, c1: cols, r0: gap.end, r1: rows };
  const choices = [left, right].filter((part) => {
    if (part.c1 - part.c0 < 2 || part.r1 - part.r0 < 2 || hitsIn(sample, part) <= 0) return false;
    const framed = boxFromSamples(box, part.c0, part.c1, part.r0, part.r1, cols, rows);
    return keepsPeople(cells, framed);
  });
  if (!choices.length) return null;
  choices.sort((a, b) => scorePart(sample, box, b, cells) - scorePart(sample, box, a, cells));
  return boxFromSamples(box, choices[0]!.c0, choices[0]!.c1, choices[0]!.r0, choices[0]!.r1, cols, rows);
}

function tighten(box: BBox, sample: Sample, cells?: Cell[]): BBox | null {
  const peeled = peelOpenWater(box, sample);
  if (peeled && !sameBox(peeled, box)) return peeled;
  return largestSolid(box, sample, cells);
}

/** Drop an outer strip that is almost entirely ocean. A real coastline stays. */
function peelOpenWater(box: BBox, sample: Sample): BBox | null {
  const cols = axisFractions(sample, "col");
  const rows = axisFractions(sample, "row");
  let c0 = 0;
  let c1 = cols.length;
  let r0 = 0;
  let r1 = rows.length;
  while (c0 + 2 < c1 && (cols[c0] ?? 1) < 0.2) c0++;
  while (c0 + 2 < c1 && (cols[c1 - 1] ?? 1) < 0.2) c1--;
  while (r0 + 2 < r1 && (rows[r0] ?? 1) < 0.2) r0++;
  while (r0 + 2 < r1 && (rows[r1 - 1] ?? 1) < 0.2) r1--;
  if (c0 === 0 && c1 === cols.length && r0 === 0 && r1 === rows.length) return null;
  return boxFromSamples(box, c0, c1, r0, r1, sample.cols, sample.rows);
}

function largestSolid(box: BBox, sample: Sample, cells?: Cell[]): BBox | null {
  const cols = sample.cols;
  const rows = sample.rows;
  if (cols < 2 || rows < 2) return null;
  const prefix = prefixSums(sample.hit);
  let best: { area: number; pop: number; c0: number; c1: number; r0: number; r1: number } | null = null;
  for (let c0 = 0; c0 < cols; c0++) {
    for (let c1 = c0 + 2; c1 <= cols; c1++) {
      for (let r0 = 0; r0 < rows; r0++) {
        for (let r1 = r0 + 2; r1 <= rows; r1++) {
          const total = (c1 - c0) * (r1 - r0);
          const hits = rectHits(prefix, c0, r0, c1, r1);
          if (hits / total < MIN_LAND_SHARE) continue;
          if (gapOn(sample, c0, c1, r0, r1)) continue;
          const part = boxFromSamples(box, c0, c1, r0, r1, cols, rows);
          if (!keepsPeople(cells, part)) continue;
          const area = areaOf(part);
          const pop = populationIn(cells, part);
          const candidate = { area, pop, c0, c1, r0, r1 };
          if (!best || prefer(candidate, best)) best = candidate;
        }
      }
    }
  }
  if (!best || (best.c0 === 0 && best.c1 === cols && best.r0 === 0 && best.r1 === rows)) return null;
  return boxFromSamples(box, best.c0, best.c1, best.r0, best.r1, cols, rows);
}

function prefer(
  candidate: { area: number; pop: number },
  best: { area: number; pop: number },
): boolean {
  if (candidate.area > best.area * 1.15) return true;
  if (best.area > candidate.area * 1.15) return false;
  if (candidate.pop !== best.pop) return candidate.pop > best.pop;
  return candidate.area > best.area;
}

function gapOn(sample: Sample, c0: number, c1: number, r0: number, r1: number): boolean {
  return narrowChannel(sliceSample(sample, c0, c1, r0, r1)) !== null;
}

function sliceSample(sample: Sample, c0: number, c1: number, r0: number, r1: number): Sample {
  const hit: boolean[][] = [];
  for (let r = r0; r < r1; r++) hit.push((sample.hit[r] ?? []).slice(c0, c1));
  return {
    hit,
    cols: c1 - c0,
    rows: r1 - r0,
    hits: 0,
    box: boxFromSamples(sample.box, c0, c1, r0, r1, sample.cols, sample.rows),
  };
}

function axisFractions(sample: Sample, axis: "col" | "row"): number[] {
  if (axis === "col") {
    const out: number[] = [];
    for (let c = 0; c < sample.cols; c++) {
      let hits = 0;
      for (let r = 0; r < sample.rows; r++) if (sample.hit[r]?.[c]) hits++;
      out.push(hits / sample.rows);
    }
    return out;
  }
  const out: number[] = [];
  for (let r = 0; r < sample.rows; r++) {
    let hits = 0;
    for (let c = 0; c < sample.cols; c++) if (sample.hit[r]?.[c]) hits++;
    out.push(hits / sample.cols);
  }
  return out;
}

function scorePart(
  sample: Sample,
  box: BBox,
  part: { c0: number; c1: number; r0: number; r1: number },
  cells?: Cell[],
): number {
  const landHits = hitsIn(sample, part);
  const framed = boxFromSamples(box, part.c0, part.c1, part.r0, part.r1, sample.cols, sample.rows);
  const pop = populationIn(cells, framed);
  const count = cells ? cells.filter((cell) => inBBox(cell.lon, cell.lat, framed)).length : 0;
  return count > 0 ? pop + landHits : landHits;
}

function hitsIn(sample: Sample, part: { c0: number; c1: number; r0: number; r1: number }): number {
  let hits = 0;
  for (let r = part.r0; r < part.r1; r++) {
    for (let c = part.c0; c < part.c1; c++) if (sample.hit[r]?.[c]) hits++;
  }
  return hits;
}

function populationIn(cells: Cell[] | undefined, box: BBox): number {
  if (!cells?.length) return 0;
  let pop = 0;
  for (const cell of cells) {
    if (inBBox(cell.lon, cell.lat, box)) pop += cell.pop;
  }
  return pop;
}

/** A shrink has to keep the cities the round is scored on. */
function keepsPeople(cells: Cell[] | undefined, box: BBox): boolean {
  if (!cells?.length) return true;
  let count = 0;
  let pop = 0;
  let total = 0;
  for (const cell of cells) {
    total += cell.pop;
    if (!inBBox(cell.lon, cell.lat, box)) continue;
    count++;
    pop += cell.pop;
  }
  if (count === 0) return false;
  return pop >= total * 0.45 || count >= Math.ceil(cells.length * 0.5);
}

function sampleLand(shape: GeoFeature | GeoCollection, box: BBox): Sample | null {
  const features = (shape.type === "FeatureCollection" ? shape.features : [shape]).filter((feature) => feature.geometry);
  if (!features.length) return null;
  const span = lonSpanOf(box);
  const latSpan = box.north - box.south;
  if (span < 0.05 || latSpan < 0.05 || span > 350) return null;
  const cols = span < 1.2 ? 4 : COLS;
  const rows = latSpan < 1.2 ? 4 : ROWS;
  const prepared = features.map((feature) => ({ feature, bounds: fastBounds(feature) }));
  const hit: boolean[][] = [];
  let hits = 0;
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    const lat = box.south + ((r + 0.5) / rows) * latSpan;
    for (let c = 0; c < cols; c++) {
      const lon = wrapLon(box.west + ((c + 0.5) / cols) * span);
      const onLand = prepared.some((entry) => {
        const bounds = entry.bounds;
        if (bounds && (lat < bounds.south || lat > bounds.north || !lonInside(lon, bounds))) return false;
        return geoContains(entry.feature as never, [lon, lat]);
      });
      row.push(onLand);
      if (onLand) hits++;
    }
    hit.push(row);
  }
  return { hit, cols, rows, hits, box };
}

function fastBounds(feature: GeoFeature): BBox | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let count = 0;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const point of ring) {
        west = Math.min(west, point[0]);
        east = Math.max(east, point[0]);
        south = Math.min(south, point[1]);
        north = Math.max(north, point[1]);
        count++;
      }
    }
  }
  if (!count) return null;
  return { west, south, east, north, wraps: false };
}

function lonInside(lon: number, box: BBox): boolean {
  if (box.west <= box.east) return lon >= box.west && lon <= box.east;
  return lon >= box.west || lon <= box.east;
}

function boxFromSamples(outer: BBox, c0: number, c1: number, r0: number, r1: number, cols: number, rows: number): BBox {
  const span = lonSpanOf(outer);
  const latSpan = outer.north - outer.south;
  const westU = outer.west + (c0 / cols) * span;
  const eastU = outer.west + (c1 / cols) * span;
  const resultSpan = eastU - westU;
  const west = wrapLon(westU);
  const east = wrapLon(eastU);
  return {
    west,
    south: outer.south + (r0 / rows) * latSpan,
    east,
    north: outer.south + (r1 / rows) * latSpan,
    wraps: resultSpan > 0 && resultSpan < 180 && west > east,
  };
}

function prefixSums(hit: boolean[][]): number[][] {
  const rows = hit.length;
  const cols = hit[0]?.length ?? 0;
  const prefix: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      prefix[r + 1]![c + 1] = (hit[r]?.[c] ? 1 : 0) + prefix[r]![c + 1]! + prefix[r + 1]![c]! - prefix[r]![c]!;
    }
  }
  return prefix;
}

function rectHits(prefix: number[][], c0: number, r0: number, c1: number, r1: number): number {
  return prefix[r1]![c1]! - prefix[r0]![c1]! - prefix[r1]![c0]! + prefix[r0]![c0]!;
}

function areaOf(box: BBox): number {
  return Math.max(0, lonSpanOf(box)) * Math.max(0, box.north - box.south);
}

function sameBox(a: BBox, b: BBox): boolean {
  return Math.abs(a.west - b.west) < 1e-6
    && Math.abs(a.east - b.east) < 1e-6
    && Math.abs(a.south - b.south) < 1e-6
    && Math.abs(a.north - b.north) < 1e-6
    && a.wraps === b.wraps;
}

function largestPiece(shape: GeoFeature | GeoCollection): GeoFeature | null {
  const features = shape.type === "FeatureCollection" ? shape.features : [shape];
  let best: GeoFeature | null = null;
  let bestArea = 0;
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const coordinates of polygons) {
      const ring = coordinates[0];
      if (!ring || ring.length < 4) continue;
      const area = planarArea(ring);
      if (area <= bestArea) continue;
      bestArea = area;
      best = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } };
    }
  }
  return best;
}

function planarArea(ring: Array<[number, number]>): number {
  let area = 0;
  let west = 180;
  let east = -180;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    if (!a || !b) continue;
    let jump = Math.abs(a[0] - b[0]);
    if (jump > 180) jump = 360 - jump;
    if (jump > 30) return 0;
    area += a[0] * b[1] - b[0] * a[1];
    west = Math.min(west, a[0]);
    east = Math.max(east, a[0]);
  }
  if (east - west > 80) return 0;
  return Math.abs(area) / 2;
}

function wrapLon(lon: number): number {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}
