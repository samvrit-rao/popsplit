import { shuffle } from "./rng.ts";
import type { PoolItem, Scale } from "./types.ts";

const SCALES: Scale[] = ["country", "subregion", "zoom"];

/**
 * Three rounds for one local day and mode.
 * The caller seeds `rng` from YYYY-MM-DD plus the mode name.
 * Rounds use three scales when the pool allows it, and at least two continents.
 */
export function selectDaily(pool: readonly PoolItem[], rng: () => number): PoolItem[] {
  const scales = shuffle(SCALES, rng);
  const picked: PoolItem[] = [];
  const usedIds = new Set<string>();
  const usedContinents = new Set<string>();
  const usedCountries = new Set<string>();

  for (let round = 0; round < 3; round++) {
    const preferScale = scales[round] ?? "country";
    const mustNewContinent = round === 2 && usedContinents.size < 2;
    const choice = pick(pool, rng, preferScale, mustNewContinent, usedIds, usedContinents, usedCountries);
    if (!choice) throw new Error("Not enough regions to build a daily puzzle.");
    picked.push(choice);
    usedIds.add(choice.id);
    usedContinents.add(choice.continent);
    if (choice.scale !== "subregion") {
      for (const id of choice.countryIds) usedCountries.add(id);
    }
  }
  return picked;
}

function pick(
  pool: readonly PoolItem[],
  rng: () => number,
  preferScale: Scale,
  mustNewContinent: boolean,
  usedIds: Set<string>,
  usedContinents: Set<string>,
  usedCountries: Set<string>,
): PoolItem | null {
  const fresh = (item: PoolItem) => !usedIds.has(item.id);
  const freeCountry = (item: PoolItem) =>
    item.scale === "subregion" || item.countryIds.every((id) => !usedCountries.has(id));
  const newContinent = (item: PoolItem) => !mustNewContinent || !usedContinents.has(item.continent);
  const filters = [
    (item: PoolItem) => fresh(item) && item.scale === preferScale && freeCountry(item) && newContinent(item),
    (item: PoolItem) => fresh(item) && item.scale === preferScale && newContinent(item),
    (item: PoolItem) => fresh(item) && newContinent(item),
    (item: PoolItem) => fresh(item),
  ];
  for (const filter of filters) {
    const list = pool.filter(filter).sort((a, b) => a.id.localeCompare(b.id));
    if (list.length) return list[Math.floor(rng() * list.length)] ?? null;
  }
  return null;
}
