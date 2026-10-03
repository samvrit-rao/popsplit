import type { BBox, Cell, PopHeader } from "./types.ts";

export type PopGrid = {
  header: PopHeader;
  nonzero: Cell[];
};

export function parsePopulation(header: PopHeader, buffer: ArrayBuffer): PopGrid {
  const { width, cellSize, bounds, encoding } = header;
  const [west, south] = bounds;
  const scale = header.scale ?? 1;
  const values: ArrayLike<number> =
    encoding === "uint16" ? new Uint16Array(buffer) : new Float32Array(buffer);
  const nonzero: Cell[] = [];
  for (let i = 0; i < values.length; i++) {
    const raw = values[i] ?? 0;
    if (raw <= 0) continue;
    const col = i % width;
    const row = Math.floor(i / width);
    nonzero.push({
      lon: west + (col + 0.5) * cellSize,
      lat: south + (row + 0.5) * cellSize,
      pop: raw * scale,
    });
  }
  return { header, nonzero };
}

export function inBBox(lon: number, lat: number, box: BBox): boolean {
  if (lat < box.south || lat > box.north) return false;
  if (!box.wraps && box.west <= box.east) return lon >= box.west && lon <= box.east;
  return lon >= box.west || lon <= box.east;
}

export function cellSpan(cells: Cell[]): { lon: number; lat: number } {
  if (!cells.length) return { lon: 0, lat: 0 };
  const lons = cells.map((cell) => cell.lon).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < lons.length; i++) {
    const current = lons[i] ?? 0;
    const next = i + 1 < lons.length ? (lons[i + 1] ?? current) : (lons[0] ?? current) + 360;
    maxGap = Math.max(maxGap, next - current);
  }
  const naive = (lons[lons.length - 1] ?? 0) - (lons[0] ?? 0);
  const circular = 360 - maxGap;
  let minLat = 90;
  let maxLat = -90;
  for (const cell of cells) {
    minLat = Math.min(minLat, cell.lat);
    maxLat = Math.max(maxLat, cell.lat);
  }
  return { lon: circular + 0.01 < naive ? circular : naive, lat: maxLat - minLat };
}

export function sumPop(cells: Cell[]): number {
  let total = 0;
  for (const cell of cells) total += cell.pop;
  return total;
}
