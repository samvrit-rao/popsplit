import { feature } from "topojson-client";
import { cellsInside, clusterShape, isPlayable, rectangleFeature, zoomWindows } from "./land.ts";
import type { PopGrid } from "./population.ts";
import { cellSpan, inBBox, sumPop } from "./population.ts";
import type {
  BBox,
  Cell,
  CountryMeta,
  CountryShape,
  GeoCollection,
  GeoFeature,
  PoolItem,
  Round,
} from "./types.ts";

const SUBREGION_NAMES: Record<string, string> = {
  "Eastern Africa": "East Africa",
  "Middle Africa": "Central Africa",
  "Northern Africa": "North Africa",
  "Southern Africa": "Southern Africa",
  "Western Africa": "West Africa",
  "Central Asia": "Central Asia",
  "Eastern Asia": "East Asia",
  "South-Eastern Asia": "Southeast Asia",
  "Southern Asia": "South Asia",
  "Western Asia": "West Asia",
  "Central Europe": "Central Europe",
  "Eastern Europe": "Eastern Europe",
  "Northern Europe": "Northern Europe",
  "Southeast Europe": "Southeast Europe",
  "Southern Europe": "Southern Europe",
  "Western Europe": "Western Europe",
  Caribbean: "The Caribbean",
  "Central America": "Central America",
  "North America": "Northern America",
  "Northern America": "Northern America",
  "Australia and New Zealand": "Australia and New Zealand",
  Melanesia: "Melanesia",
  Micronesia: "Micronesia",
  Polynesia: "Polynesia",
  "South America": "South America",
};

const UNNAMED = [
  { id: "kosovo", name: "Kosovo", iso3: "XKX", continent: "Europe", subregion: "Southern Europe", lon: 20.9, lat: 42.6 },
  { id: "somaliland", name: "Somaliland", iso3: "SOL", continent: "Africa", subregion: "Eastern Africa", lon: 46.3, lat: 9.6 },
  { id: "northern-cyprus", name: "Northern Cyprus", iso3: "NCY", continent: "Asia", subregion: "Western Asia", lon: 33.6, lat: 35.3 },
];

type Atlas = {
  objects: { countries: object };
};

export async function buildCountries(
  atlas: Atlas,
  meta: CountryMeta[],
  grid: PopGrid,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<CountryShape[]> {
  const collection = feature(atlas as never, atlas.objects.countries as never) as GeoCollection;
  const metaById = new Map(meta.map((country) => [country.id, country]));
  const grouped = new Map<string, GeoFeature[]>();
  const unnamed: GeoFeature[] = [];

  for (const item of collection.features) {
    if (!item.geometry) continue;
    if (item.id == null || item.id === "") {
      unnamed.push(item);
      continue;
    }
    const id = String(Number(item.id));
    const list = grouped.get(id) ?? [];
    list.push(item);
    grouped.set(id, list);
  }

  const jobs: Array<{ id: string; name: string; iso3: string; continent: string; subregion: string; features: GeoFeature[] }> = [];
  for (const [id, features] of grouped) {
    const info = metaById.get(id);
    if (!info || info.continent === "Antarctica") continue;
    jobs.push({ ...info, features });
  }
  for (const item of unnamed) {
    const center = averagePoint(item);
    const match = UNNAMED.find((entry) => Math.hypot(entry.lon - center[0], entry.lat - center[1]) < 4);
    if (!match) continue;
    jobs.push({ ...match, features: [item] });
  }

  const countries: CountryShape[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const merged: GeoFeature = mergeFeatures(job.features);
    const clustered = clusterShape(merged);
    const cells = cellsInside(grid, clustered.draw, null);
    countries.push({
      id: job.id,
      name: job.name,
      iso3: job.iso3,
      continent: job.continent,
      subregion: job.subregion,
      draw: clustered.draw,
      bounds: clustered.bounds,
      cells,
      pop: sumPop(cells),
      trimmed: clustered.trimmed,
    });
    if (onProgress && i % 4 === 0) {
      onProgress(i, jobs.length, job.name);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));
  onProgress?.(jobs.length, jobs.length, "Ready");
  return countries;
}

export function buildPool(countries: CountryShape[]): PoolItem[] {
  const pool: PoolItem[] = [];
  for (const country of countries) {
    if (!isPlayable(country.cells, 4, 80_000)) continue;
    pool.push({
      id: `country-${country.id}`,
      name: country.name,
      detail: country.trimmed ? "Main landmass" : null,
      continent: country.continent,
      scale: "country",
      countryIds: [country.id],
      window: null,
    });
    if (country.cells.length < 8 || country.bounds.wraps) continue;
    const countryPop = country.pop || 1;
    for (const window of zoomWindows(country.bounds)) {
      const cells = country.cells.filter((cell) => inBBox(cell.lon, cell.lat, window.box));
      const pop = sumPop(cells);
      const fraction = pop / countryPop;
      if (!isPlayable(cells, 4, 60_000) || fraction < 0.1 || fraction > 0.72) continue;
      pool.push({
        id: `zoom-${country.id}-${window.label.toLowerCase()}`,
        name: country.name,
        detail: window.label,
        continent: country.continent,
        scale: "zoom",
        countryIds: [country.id],
        window: window.box,
      });
    }
  }

  const groups = new Map<string, CountryShape[]>();
  for (const country of countries) {
    if (!country.subregion || country.pop <= 0) continue;
    const list = groups.get(country.subregion) ?? [];
    list.push(country);
    groups.set(country.subregion, list);
  }

  for (const [subregion, members] of groups) {
    const named = SUBREGION_NAMES[subregion] ?? subregion;
    const continent = dominantContinent(members);
    const allCells = members.flatMap((country) => country.cells);
    const span = cellSpan(allCells);
    const playableMembers = members.filter((country) => country.cells.length > 0);
    if (playableMembers.length >= 2 && span.lon <= 52 && span.lat <= 42 && isPlayable(allCells, 8, 200_000)) {
      pool.push({
        id: `region-${slug(subregion)}`,
        name: named,
        detail: null,
        continent,
        scale: "subregion",
        countryIds: playableMembers.map((country) => country.id),
        window: null,
      });
      continue;
    }
    const slices = sliceGroup(playableMembers, named, continent, subregion);
    pool.push(...slices);
  }
  return pool;
}

export function materialize(item: PoolItem, countries: Map<string, CountryShape>): Round | null {
  const members = item.countryIds.map((id) => countries.get(id)).filter((country): country is CountryShape => !!country);
  if (!members.length) return null;
  const window = item.window;
  const cells = members.flatMap((country) =>
    window ? country.cells.filter((cell) => inBBox(cell.lon, cell.lat, window)) : country.cells,
  );
  if (sumPop(cells) <= 0) return null;
  const drawMembers = window
    ? members.filter((country) => boundsOverlap(country.bounds, window))
    : members;
  const draw: GeoCollection = {
    type: "FeatureCollection",
    features: (drawMembers.length ? drawMembers : members).flatMap((country) => country.draw.features),
  };
  const fit = window ? rectangleFeature(window) : draw;
  return {
    id: item.id,
    name: item.name,
    detail: item.detail,
    continent: item.continent,
    scale: item.scale,
    draw,
    fit,
    cells,
  };
}

export function randomPoolItem(pool: PoolItem[], rng: () => number = Math.random): PoolItem | null {
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)] ?? null;
}

function sliceGroup(members: CountryShape[], name: string, continent: string, subregion: string): PoolItem[] {
  const cells = members.flatMap((country) => country.cells);
  if (!cells.length) return [];
  let south = 90;
  let north = -90;
  for (const cell of cells) {
    south = Math.min(south, cell.lat);
    north = Math.max(north, cell.lat);
  }
  const items: PoolItem[] = [];
  const height = Math.min(28, Math.max(12, (north - south) * 0.55));
  for (let lon = -180; lon < 180; lon += 14) {
    const west = lon;
    const east = Math.min(180, lon + 30);
    const box: BBox = { west, south: Math.max(-56, south - 1), east, north: Math.min(78, north + 1), wraps: false };
    if (box.north - box.south > height + 8) {
      box.south = (south + north) / 2 - height / 2;
      box.north = (south + north) / 2 + height / 2;
    }
    const inside = cells.filter((cell) => inBBox(cell.lon, cell.lat, box));
    const represented = new Set(
      members.filter((country) => country.cells.some((cell) => inBBox(cell.lon, cell.lat, box))).map((country) => country.id),
    );
    if (represented.size < 2 || !isPlayable(inside, 8, 180_000)) continue;
    const label = sliceLabel(inside, cells);
    items.push({
      id: `region-${slug(subregion)}-${west}-${label.toLowerCase()}`,
      name,
      detail: label,
      continent,
      scale: "subregion",
      countryIds: [...represented],
      window: box,
    });
  }
  return dedupeSlices(items);
}

function sliceLabel(inside: Cell[], all: Cell[]): string {
  const focus = centroidOf(inside);
  const outer = centroidOf(all);
  const dx = focus.lon - outer.lon;
  const dy = focus.lat - outer.lat;
  if (Math.hypot(dx / 18, dy / 12) < 0.22) return "Central";
  const names = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"];
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return names[Math.round(((deg + 360) % 360) / 45) % 8] ?? "Central";
}

function dedupeSlices(items: PoolItem[]): PoolItem[] {
  const seen = new Set<string>();
  const out: PoolItem[] = [];
  for (const item of items) {
    const key = `${item.name}|${item.detail}|${item.countryIds.slice().sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dominantContinent(members: CountryShape[]): string {
  const pops = new Map<string, number>();
  for (const country of members) pops.set(country.continent, (pops.get(country.continent) ?? 0) + country.pop);
  let best = members[0]?.continent ?? "Other";
  let max = -1;
  for (const [continent, pop] of pops) {
    if (pop > max) {
      max = pop;
      best = continent;
    }
  }
  return best;
}

function mergeFeatures(features: GeoFeature[]): GeoFeature {
  if (features.length === 1) return features[0]!;
  const coordinates = features.flatMap((item) => {
    if (!item.geometry) return [];
    if (item.geometry.type === "Polygon") return [item.geometry.coordinates];
    return item.geometry.coordinates;
  });
  return { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates } };
}

function averagePoint(feature: GeoFeature): [number, number] {
  const ring = feature.geometry?.type === "Polygon"
    ? feature.geometry.coordinates[0]
    : feature.geometry?.coordinates[0]?.[0];
  if (!ring?.length) return [0, 0];
  let lon = 0;
  let lat = 0;
  for (const point of ring) {
    lon += point[0];
    lat += point[1];
  }
  return [lon / ring.length, lat / ring.length];
}

function centroidOf(cells: Cell[]): { lon: number; lat: number } {
  let lon = 0;
  let lat = 0;
  let pop = 0;
  for (const cell of cells) {
    lon += cell.lon * cell.pop;
    lat += cell.lat * cell.pop;
    pop += cell.pop;
  }
  if (pop <= 0) return { lon: 0, lat: 0 };
  return { lon: lon / pop, lat: lat / pop };
}

function boundsOverlap(a: BBox, b: BBox): boolean {
  if (a.north < b.south || a.south > b.north) return false;
  if (a.wraps || b.wraps) return true;
  return a.east >= b.west && a.west <= b.east;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
