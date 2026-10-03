import type { BBox, GeoCollection, GeoFeature, LonLat } from "./types.ts";

/** Bounds of the shortest longitude arc that covers every vertex. */
export function boundsOfGeometry(shape: GeoFeature | GeoCollection | null | undefined): BBox | null {
  const points: LonLat[] = [];
  eachSegment(shape, (a, b) => {
    points.push(a, b);
  });
  return boundsFromPoints(points);
}

/**
 * Bounds of the geometry that actually falls inside `limit`.
 * A rectangular window that runs off the coast shrinks back to the land.
 */
export function boundsClipped(shape: GeoFeature | GeoCollection | null | undefined, limit: BBox): BBox | null {
  const span = limit.wraps ? limit.east + 360 - limit.west : limit.east - limit.west;
  if (span <= 0 || span > 350) return boundsOfGeometry(shape);
  const points: LonLat[] = [];
  eachSegment(shape, (a, b) => {
    let x1 = localLon(a[0], limit.west);
    let x2 = localLon(b[0], limit.west);
    if (x2 - x1 > 180) x2 -= 360;
    else if (x1 - x2 > 180) x1 -= 360;
    const clipped = clipSegment(x1, a[1], x2, b[1], -0.02, limit.south - 0.02, span + 0.02, limit.north + 0.02);
    if (!clipped) return;
    points.push([unlocal(clipped[0], limit.west), clipped[1]], [unlocal(clipped[2], limit.west), clipped[3]]);
  });
  return boundsFromPoints(points);
}

export function boundsFromPoints(points: LonLat[]): BBox | null {
  if (!points.length) return null;
  const lons = points.map((point) => point[0]).sort((a, b) => a - b);
  let maxGap = -1;
  let gapAt = 0;
  for (let i = 0; i < lons.length; i++) {
    const current = lons[i] ?? 0;
    const next = i + 1 < lons.length ? (lons[i + 1] ?? current) : (lons[0] ?? 0) + 360;
    const gap = next - current;
    if (gap > maxGap) {
      maxGap = gap;
      gapAt = i;
    }
  }
  const naive = (lons[lons.length - 1] ?? 0) - (lons[0] ?? 0);
  const circular = 360 - maxGap;
  const useShort = circular + 0.01 < naive;
  const west = useShort ? (lons[(gapAt + 1) % lons.length] ?? 0) : (lons[0] ?? 0);
  const east = useShort ? (lons[gapAt] ?? 0) : (lons[lons.length - 1] ?? 0);
  let south = 90;
  let north = -90;
  for (const point of points) {
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
  }
  return { west, south, east, north, wraps: useShort && west > east };
}

export function lonSpanOf(box: BBox): number {
  return box.wraps ? box.east + 360 - box.west : box.east - box.west;
}

function eachSegment(shape: GeoFeature | GeoCollection | null | undefined, visit: (a: LonLat, b: LonLat) => void): void {
  if (!shape) return;
  if (shape.type === "FeatureCollection") {
    for (const feature of shape.features) eachSegment(feature, visit);
    return;
  }
  const geometry = shape.geometry;
  if (!geometry) return;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        if (!a || !b) continue;
        if (a[0] === b[0] && a[1] === b[1]) continue;
        visit(a, b);
      }
    }
  }
}

function localLon(lon: number, west: number): number {
  let x = lon - west;
  if (x < 0) x += 360;
  if (x >= 360) x -= 360;
  return x;
}

function unlocal(x: number, west: number): number {
  let lon = west + x;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

function clipSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
): [number, number, number, number] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1];
  let u1 = 0;
  let u2 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i] ?? 0;
    const qi = q[i] ?? 0;
    if (pi === 0) {
      if (qi < 0) return null;
    } else {
      const t = qi / pi;
      if (pi < 0) u1 = Math.max(u1, t);
      else u2 = Math.min(u2, t);
      if (u1 > u2) return null;
    }
  }
  return [x1 + u1 * dx, y1 + u1 * dy, x1 + u2 * dx, y1 + u2 * dy];
}
