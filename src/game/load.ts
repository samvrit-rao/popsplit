import { parsePopulation } from "./population.ts";
import type { CountryMeta, CountryShape, PoolItem, PopHeader } from "./types.ts";
import { buildCountries, buildPool } from "./world.ts";

export type GameData = {
  header: PopHeader;
  countries: CountryShape[];
  byId: Map<string, CountryShape>;
  pool: PoolItem[];
};

export async function loadGameData(onProgress: (ratio: number, label: string) => void): Promise<GameData> {
  onProgress(0.08, "Loading borders and population");
  const base = import.meta.env.BASE_URL;
  const [header, buffer, atlas, meta] = await Promise.all([
    getJson<PopHeader>(asset(base, "data/population.json")),
    getBuffer(asset(base, "data/population.bin")),
    getJson<{ objects: { countries: object } }>(asset(base, "data/countries-50m.json")),
    getJson<CountryMeta[]>(asset(base, "data/country-meta.json")),
  ]);
  onProgress(0.28, "Placing cities inside borders");
  const grid = parsePopulation(header, buffer);
  const countries = await buildCountries(atlas, meta, grid, (done, total, label) => {
    onProgress(0.28 + 0.66 * (done / Math.max(1, total)), label);
  });
  onProgress(0.96, "Laying out today's maps");
  const pool = buildPool(countries);
  return { header, countries, byId: new Map(countries.map((country) => [country.id, country])), pool };
}

function asset(base: string, path: string): string {
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json() as Promise<T>;
}

async function getBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.arrayBuffer();
}
