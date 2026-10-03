import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectDaily } from "../src/game/daily.ts";
import { hashString, mulberry32 } from "../src/game/rng.ts";
import { parsePopulation } from "../src/game/population.ts";
import type { CountryMeta, PopHeader } from "../src/game/types.ts";
import { makeProjection } from "../src/game/project.ts";
import { buildCountries, buildPool, materialize } from "../src/game/world.ts";

const header = JSON.parse(readFileSync("public/data/population.json", "utf8")) as PopHeader;
const file = readFileSync("public/data/population.bin");
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const grid = parsePopulation(header, buffer);
const atlas = JSON.parse(readFileSync("public/data/countries-50m.json", "utf8"));
const meta = JSON.parse(readFileSync("public/data/country-meta.json", "utf8")) as CountryMeta[];
const countries = await buildCountries(atlas, meta, grid);
const byId = new Map(countries.map((country) => [country.id, country]));
const pool = buildPool(countries);

const counts = { country: 0, subregion: 0, zoom: 0 };
for (const item of pool) counts[item.scale] += 1;
console.log(`pool  countries=${countries.length}  country=${counts.country}  region=${counts.subregion}  zoom=${counts.zoom}`);

assert.ok(counts.country >= 20, `only ${counts.country} country rounds`);
assert.ok(counts.subregion >= 8, `only ${counts.subregion} region rounds`);
assert.ok(counts.zoom >= 8, `only ${counts.zoom} zoom rounds`);

const named = ["United States", "France", "India", "Japan", "Brazil", "Nigeria", "China"];
for (const name of named) {
  const country = countries.find((item) => item.name === name);
  assert.ok(country, `missing ${name}`);
  assert.ok((country?.pop ?? 0) > 500_000, `${name} mapped pop ${country?.pop}`);
}

for (const mode of ["Halves", "Thirds", "Quarters"]) {
  const rounds = selectDaily(pool, mulberry32(hashString(`2026-10-03|${mode}`)));
  assert.equal(rounds.length, 3);
  assert.ok(new Set(rounds.map((round) => round.continent)).size >= 2, mode);
  assert.equal(new Set(rounds.map((round) => round.scale)).size, 3, mode);
  for (const round of rounds) {
    const made = materialize(round, byId);
    assert.ok(made && made.cells.length >= 4, `${round.id} failed to materialize`);
    const projection = makeProjection(made!.fit, 900, 640);
    const sample = made!.cells[0]!;
    const point = projection([sample.lon, sample.lat]);
    assert.ok(point && Number.isFinite(point[0]) && Number.isFinite(point[1]), `${round.id} projection`);
  }
  console.log(mode, rounds.map((round) => `${round.scale}:${round.name}${round.detail ? " / " + round.detail : ""} (${round.continent})`).join("  ·  "));
}

const repeat = selectDaily(pool, mulberry32(hashString("2026-10-03|Halves"))).map((round) => round.id);
const repeat2 = selectDaily(pool, mulberry32(hashString("2026-10-03|Halves"))).map((round) => round.id);
assert.deepEqual(repeat, repeat2);
