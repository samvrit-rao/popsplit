import { geoBounds } from "d3-geo";
import { bboxFromBounds } from "./land.ts";
import type { BBox, Cell, GeoCollection, GeoFeature } from "./types.ts";

const MARGIN = 0.18;

export type OsmView = { lat: number; lon: number; zoom: number };

/** Geographic rectangle that is scored and drawn as the play frame. */
export function frameOfFit(fit: GeoFeature | GeoCollection, cells: Cell[]): BBox {
  try {
    const box = bboxFromBounds(geoBounds(fit as never) as [[number, number], [number, number]]);
    if (Number.isFinite(box.west) && box.north > box.south) return normalizeFrame(box);
  } catch {
    /* use the cities that are actually scored */
  }
  return normalizeFrame(boundsFromCells(cells));
}

/**
 * Web Mercator camera for a Leaflet map. The frame stays centered, with
 * context around it so the basemap reads as a place rather than a tight crop.
 */
export function osmViewFor(frame: BBox, width: number, height: number): OsmView {
  const lonSpan = frame.wraps ? frame.east + 360 - frame.west : frame.east - frame.west;
  const latSpan = Math.max(0.05, frame.north - frame.south);
  const south = Math.max(-85, frame.south - latSpan * MARGIN);
  const north = Math.min(85, frame.north + latSpan * MARGIN);
  const viewLon = Math.max(0.2, lonSpan * (1 + MARGIN * 2));
  let lon = frame.west + lonSpan / 2;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  const lat = Math.max(-85, Math.min(85, (frame.south + frame.north) / 2));
  const usableW = Math.max(48, width - 28);
  const usableH = Math.max(48, height - 28);
  const zoomX = Math.log2(usableW / (256 * (viewLon / 360)));
  const zoomY = Math.log2(usableH / (256 * Math.max(Math.abs(mercatorY(north) - mercatorY(south)), 1e-6)));
  // Integer zoom keeps OSM tiles sharp. Flooring never crops the frame.
  const zoom = Math.floor(Math.max(2, Math.min(16, Math.min(zoomX, zoomY))));
  return { lat, lon, zoom };
}

function boundsFromCells(cells: Cell[]): BBox {
  if (!cells.length) return { west: -10, south: -10, east: 10, north: 10, wraps: false };
  const lons = cells.map((cell) => cell.lon).sort((a, b) => a - b);
  let maxGap = 0;
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
  const west = lons[(gapAt + 1) % lons.length] ?? 0;
  const east = lons[gapAt] ?? 0;
  let south = 90;
  let north = -90;
  for (const cell of cells) {
    south = Math.min(south, cell.lat);
    north = Math.max(north, cell.lat);
  }
  return { west, south, east, north, wraps: west > east };
}

function normalizeFrame(box: BBox): BBox {
  let { west, south, east, north, wraps } = box;
  const lonSpan = wraps ? east + 360 - west : east - west;
  const latSpan = north - south;
  if (!wraps && lonSpan < 0.2) {
    const mid = (west + east) / 2;
    west = mid - 0.1;
    east = mid + 0.1;
  }
  if (latSpan < 0.2) {
    const mid = (south + north) / 2;
    south = mid - 0.1;
    north = mid + 0.1;
  }
  return {
    west,
    south: Math.max(-85, south),
    east,
    north: Math.min(85, north),
    wraps,
  };
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const sine = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}
