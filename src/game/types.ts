export type Scale = "country" | "subregion" | "zoom" | "state";
export type SplitKind = "halves" | "thirds" | "quarters";

export type Cell = { lon: number; lat: number; pop: number };
export type ScreenCell = { x: number; y: number; pop: number };

export type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
  wraps: boolean;
};

export type LonLat = [number, number];
export type PolygonGeom = { type: "Polygon"; coordinates: LonLat[][] };
export type MultiPolygonGeom = { type: "MultiPolygon"; coordinates: LonLat[][][] };
export type Geom = PolygonGeom | MultiPolygonGeom;

export type GeoFeature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown> | null;
  geometry: Geom | null;
};

export type GeoCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

export type HalvesCut = { kind: "halves"; ax: number; ay: number; bx: number; by: number };
export type ThirdsCut = { kind: "thirds"; cx: number; cy: number; angles: [number, number, number] };
export type QuartersCut = { kind: "quarters"; cx: number; cy: number; angle: number };
export type Cut = HalvesCut | ThirdsCut | QuartersCut;

export type PoolItem = {
  id: string;
  name: string;
  detail: string | null;
  continent: string;
  scale: Scale;
  countryIds: string[];
  window: BBox | null;
};

export type Round = {
  id: string;
  name: string;
  detail: string | null;
  continent: string;
  scale: Scale;
  draw: GeoCollection;
  fit: GeoFeature | GeoCollection;
  cells: Cell[];
};

export type PopHeader = {
  source: string;
  sourceDetail: string;
  sourceUrl: string;
  bounds: [number, number, number, number];
  cellSize: number;
  width: number;
  height: number;
  encoding: "float32" | "uint16";
  scale?: number;
  rowOrigin: "south";
  nonzeroCells?: number;
  totalPopulation?: number;
};

export type CountryMeta = {
  id: string;
  name: string;
  iso3: string;
  continent: string;
  subregion: string;
};

export type CountryShape = {
  id: string;
  name: string;
  iso3: string;
  continent: string;
  subregion: string;
  draw: GeoCollection;
  bounds: BBox;
  cells: Cell[];
  pop: number;
  trimmed: boolean;
};
