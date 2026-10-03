import { boundsClipped, boundsOfGeometry, lonSpanOf } from "./bounds.ts";
import { hasMiddleWater, landFraction, solidLandFrame } from "./landShare.ts";
import type { BBox, Cell, GeoCollection, GeoFeature } from "./types.ts";

const MARGIN = 0.18;

export type OsmView = { lat: number; lon: number; zoom: number };

/**
 * Play frame for one round. Uses the land inside the fit window, so a
 * rectangle that runs off the coast does not cover empty ocean, and a
 * dateline island is not stretched into a world view. A frame that would
 * be mostly water, or that would put a gulf or lake through the middle,
 * shrinks onto the land side.
 */
export function frameOfFit(fit: GeoFeature | GeoCollection, cells: Cell[], draw?: GeoFeature | GeoCollection): BBox {
  const fitBox = boundsOfGeometry(fit);
  const drawBox = draw ? boundsOfGeometry(draw) : null;
  const window = fitBox && lonSpanOf(fitBox) > 200 && drawBox && lonSpanOf(drawBox) + 20 < lonSpanOf(fitBox) ? drawBox : fitBox;
  const clipped = draw && window && lonSpanOf(window) <= 200 ? boundsClipped(draw, window) : null;
  let box = clipped ?? window ?? drawBox;
  const cellsBox = boundsFromCells(cells);
  // A window over the interior of a country has coastline vertices on only
  // one side. Clipping to those vertices would drop the inland cities.
  if (box && cellsBox && window && (lonSpanOf(cellsBox) > lonSpanOf(box) + 0.35 || cellsBox.north - cellsBox.south > box.north - box.south + 0.35)) {
    box = window;
  }
  if (box && cellsBox && (lonSpanOf(box) > Math.max(40, lonSpanOf(cellsBox) * 3) || box.north - box.south > Math.max(30, (cellsBox.north - cellsBox.south) * 3))) {
    box = cellsBox;
  }
  if (!box) box = cellsBox ?? { west: -10, south: -10, east: 10, north: 10, wraps: false };
  const shape = draw ?? fit;
  const solid = solidLandFrame(shape, box, cells);
  if (solid) box = solid.box;
  const bare = normalizeFrame(box);
  const padded = normalizeFrame(expandBox(box, 0.04, 0.35));
  if (hasMiddleWater(shape, padded)) return bare;
  if (landFraction(shape, padded) + 0.08 < landFraction(shape, bare)) return bare;
  return padded;
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
  const zoom = Math.max(2, Math.min(16, Math.min(zoomX, zoomY)));
  return { lat, lon, zoom };
}

function expandBox(box: BBox, fraction: number, maxDeg: number): BBox {
  const lonSpan = Math.max(0.05, lonSpanOf(box));
  const latSpan = Math.max(0.05, box.north - box.south);
  const lonPad = Math.min(maxDeg, Math.max(0.06, lonSpan * fraction));
  const latPad = Math.min(maxDeg, Math.max(0.06, latSpan * fraction));
  const west = box.west - lonPad;
  const eastUnwrapped = (box.wraps ? box.east + 360 : box.east) + lonPad;
  let east = eastUnwrapped;
  if (east > 180) east -= 360;
  const wraps = west > east;
  return {
    west: Math.max(-180, west),
    south: Math.max(-85, box.south - latPad),
    east,
    north: Math.min(85, box.north + latPad),
    wraps,
  };
}

function boundsFromCells(cells: Cell[]): BBox | null {
  if (!cells.length) return null;
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
