import assert from "node:assert/strict";
import { selectDaily } from "../src/game/daily.ts";
import { hashString, mulberry32 } from "../src/game/rng.ts";
import type { PoolItem, Scale } from "../src/game/types.ts";

const continents = ["Africa", "Europe", "Asia", "North America", "South America", "Oceania"];
const scales: Scale[] = ["country", "subregion", "zoom"];
const pool: PoolItem[] = [];
for (const continent of continents) {
  for (const scale of scales) {
    for (let n = 0; n < 4; n++) {
      pool.push({
        id: `${scale}-${continent}-${n}`,
        name: `${continent} ${scale} ${n}`,
        detail: null,
        continent,
        scale,
        countryIds: [`${continent}-${n}`],
        window: null,
      });
    }
  }
}

function run(date: string, mode: string) {
  return selectDaily(pool, mulberry32(hashString(`${date}|${mode}`)));
}

const first = run("2026-10-03", "Halves");
const again = run("2026-10-03", "Halves");
const otherMode = run("2026-10-03", "Thirds");
const nextDay = run("2026-10-04", "Halves");

assert.deepEqual(first.map((item) => item.id), again.map((item) => item.id));
assert.equal(first.length, 3);
assert.ok(new Set(first.map((item) => item.continent)).size >= 2);
assert.equal(new Set(first.map((item) => item.scale)).size, 3);
assert.notDeepEqual(first.map((item) => item.id), otherMode.map((item) => item.id));
assert.notDeepEqual(first.map((item) => item.id), nextDay.map((item) => item.id));

console.log(`daily ok  ${first.map((item) => `${item.scale}:${item.continent}`).join(" | ")}`);
