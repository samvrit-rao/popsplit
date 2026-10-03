import { geoBounds, geoCentroid, geoConicEqualArea, geoMercator } from "d3-geo";
import { bboxFromBounds } from "./land.ts";
import type { GeoCollection, GeoFeature } from "./types.ts";

export function makeProjection(fit: GeoFeature | GeoCollection, width: number, height: number) {
  const centroid = geoCentroid(fit as never);
  const bounds = bboxFromBounds(geoBounds(fit as never) as [[number, number], [number, number]]);
  const lonSpan = bounds.wraps ? 180 - bounds.west + (bounds.east + 180) : bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  const projection = Math.max(lonSpan, latSpan) >= 35 || bounds.wraps ? geoConicEqualArea() : geoMercator();
  if (Number.isFinite(centroid[0])) projection.rotate([-centroid[0], 0]);
  const pad = Math.max(18, Math.min(width, height) * 0.055);
  projection.fitExtent(
    [
      [pad, pad],
      [Math.max(pad + 8, width - pad), Math.max(pad + 8, height - pad)],
    ],
    fit as never,
  );
  return projection;
}
