import { geoArea, geoBounds, geoCentroid, geoContains } from "d3-geo";
import { boundsOfGeometry, lonSpanOf } from "./bounds.ts";
import { cellSpan, inBBox, sumPop } from "./population.ts";
import type { PopGrid } from "./population.ts";
import type { BBox, Cell, GeoCollection, GeoFeature, LonLat } from "./types.ts";

type Part = {
  feature: GeoFeature;
  area: number;
  centroid: LonLat;
  box: BBox;
};

export function bboxFromBounds(bounds: [[number, number], [number, number]]): BBox {
  const west = bounds[0][0];
  const south = bounds[0][1];
  const east = bounds[1][0];
  const north = bounds[1][1];
  return { west, south, east, north, wraps: west > east };
}

export function cellsInside(grid: PopGrid, shape: GeoFeature | GeoCollection, limit: BBox | null): Cell[] {
  const box = limit ?? bboxOf(shape);
  const features = shape.type === "FeatureCollection" ? shape.features : [shape];
  const cells: Cell[] = [];
  for (const cell of grid.nonzero) {
    if (box && !inBBox(cell.lon, cell.lat, box)) continue;
    if (features.some((feature) => feature.geometry && geoContains(feature as never, [cell.lon, cell.lat]))) {
      cells.push(cell);
    }
  }
  return cells;
}

export function clusterShape(feature: GeoFeature): { draw: GeoCollection; trimmed: boolean; bounds: BBox } {
  const parts = explode(feature)
    .map((part) => {
      const box = bboxOf(part);
      return {
        feature: part,
        area: geoArea(part as never),
        centroid: geoCentroid(part as never) as LonLat,
        box: box ?? { west: 0, south: 0, east: 0, north: 0, wraps: false },
      };
    })
    .filter((part) => part.area > 0)
    .sort((a, b) => b.area - a.area);

  if (!parts.length) {
    return {
      draw: { type: "FeatureCollection", features: feature.geometry ? [feature] : [] },
      trimmed: false,
      bounds: bboxOf(feature) ?? { west: -1, south: -1, east: 1, north: 1, wraps: false },
    };
  }

  const kept: Part[] = [parts[0]!];
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of parts) {
      if (kept.includes(candidate)) continue;
      const near = kept.some((part) => angularDistance(part.centroid, candidate.centroid) <= 22);
      if (!near) continue;
      const span = centroidSpan([...kept, candidate]);
      if (span.lon > 68 || span.lat > 50) continue;
      kept.push(candidate);
      changed = true;
    }
  }

  const draw: GeoCollection = { type: "FeatureCollection", features: kept.map((part) => part.feature) };
  return {
    draw,
    trimmed: kept.length !== parts.length,
    bounds: bboxOf(draw) ?? kept[0]!.box,
  };
}

export function isPlayable(cells: Cell[], minCells = 4, minPop = 40_000): boolean {
  if (cells.length < minCells || sumPop(cells) < minPop) return false;
  const span = cellSpan(cells);
  return span.lon >= 0.45 || span.lat >= 0.45;
}

export function rectangleFeature(box: BBox): GeoFeature {
  const west = box.west;
  const east = box.wraps ? box.west + 30 : box.east;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [west, box.south],
        [east, box.south],
        [east, box.north],
        [west, box.north],
        [west, box.south],
      ]],
    },
  };
}

export function zoomWindows(box: BBox): Array<{ box: BBox; label: string }> {
  if (box.wraps) return [];
  const lonSpan = box.east - box.west;
  const latSpan = box.north - box.south;
  if (lonSpan < 6 && latSpan < 6) return [];
  const width = clamp(lonSpan * 0.46, 3, 16);
  const height = clamp(latSpan * 0.46, 3, 14);
  const spots: Array<[number, number, string]> = [
    [0.32, 0.7, "Northwest"],
    [0.5, 0.72, "North"],
    [0.68, 0.7, "Northeast"],
    [0.3, 0.5, "West"],
    [0.5, 0.5, "Central"],
    [0.7, 0.5, "East"],
    [0.32, 0.3, "Southwest"],
    [0.5, 0.28, "South"],
    [0.68, 0.3, "Southeast"],
  ];
  const windows = [];
  for (const [fx, fy, label] of spots) {
    const cx = box.west + lonSpan * fx;
    const cy = box.south + latSpan * fy;
    let west = cx - width / 2;
    let east = cx + width / 2;
    let south = cy - height / 2;
    let north = cy + height / 2;
    if (west < box.west) {
      east += box.west - west;
      west = box.west;
    }
    if (east > box.east) {
      west -= east - box.east;
      east = box.east;
    }
    if (south < box.south) {
      north += box.south - south;
      south = box.south;
    }
    if (north > box.north) {
      south -= north - box.north;
      north = box.north;
    }
    west = Math.max(west, box.west);
    east = Math.min(east, box.east);
    south = Math.max(south, box.south);
    north = Math.min(north, box.north);
    if (east - west < 2 || north - south < 2) continue;
    windows.push({ box: { west, south, east, north, wraps: false }, label });
  }
  return windows;
}

export function compassBetween(inner: BBox, outer: { lon: number; lat: number }): string {
  const dx = (inner.west + inner.east) / 2 - outer.lon;
  const dy = (inner.south + inner.north) / 2 - outer.lat;
  if (Math.hypot(dx / 20, dy / 12) < 0.18) return "Central";
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const names = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"];
  return names[Math.round(((deg + 360) % 360) / 45) % 8] ?? "Central";
}

function explode(feature: GeoFeature): GeoFeature[] {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [feature];
  return geometry.coordinates.map((coordinates) => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates },
  }));
}

function bboxOf(shape: GeoFeature | GeoCollection): BBox | null {
  let geo: BBox | null = null;
  try {
    geo = bboxFromBounds(geoBounds(shape as never) as [[number, number], [number, number]]);
  } catch {
    geo = null;
  }
  const arc = boundsOfGeometry(shape);
  if (!geo) return arc;
  if (!arc) return geo;
  // geoBounds turns a tiny dateline island into a span of the whole world.
  if (lonSpanOf(geo) > lonSpanOf(arc) + 20) return arc;
  return geo;
}

function centroidSpan(parts: Part[]): { lon: number; lat: number } {
  const origin = parts[0]?.centroid[0] ?? 0;
  let minLon = 0;
  let maxLon = 0;
  let minLat = 90;
  let maxLat = -90;
  for (const part of parts) {
    let dLon = part.centroid[0] - origin;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    minLon = Math.min(minLon, dLon);
    maxLon = Math.max(maxLon, dLon);
    minLat = Math.min(minLat, part.centroid[1]);
    maxLat = Math.max(maxLat, part.centroid[1]);
  }
  return { lon: maxLon - minLon, lat: maxLat - minLat };
}

function angularDistance(a: LonLat, b: LonLat): number {
  let dLon = a[0] - b[0];
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const dLat = a[1] - b[1];
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot(dLon * cos, dLat);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
