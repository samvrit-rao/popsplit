declare module "d3-geo" {
  export interface GeoProjection {
    (point: [number, number]): [number, number] | null;
    rotate(rotation: [number, number] | [number, number, number]): this;
    fitExtent(extent: [[number, number], [number, number]], object: unknown): this;
    scale(): number;
  }

  export function geoContains(feature: unknown, point: [number, number]): boolean;
  export function geoBounds(feature: unknown): [[number, number], [number, number]];
  export function geoCentroid(feature: unknown): [number, number];
  export function geoArea(feature: unknown): number;
  export function geoMercator(): GeoProjection;
  export function geoConicEqualArea(): GeoProjection;
  export function geoPath(projection?: GeoProjection, context?: unknown): (object: unknown) => void;
}

declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      id?: string | number;
      properties: Record<string, unknown> | null;
      geometry: { type: "Polygon"; coordinates: [number, number][][] } | { type: "MultiPolygon"; coordinates: [number, number][][][] } | null;
    }>;
  };
}
