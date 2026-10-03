/**
 * Join world-atlas country ids to common names, continents, and UN subregions.
 *
 * Name source (committed output, so the app does not fetch this at runtime):
 *   https://raw.githubusercontent.com/mledoze/countries/master/countries.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const namesPath = resolve(root, "data/raw/countries.json");
const NAMES_URL = "https://raw.githubusercontent.com/mledoze/countries/master/countries.json";

const MANUAL = {
  158: { name: "Taiwan", iso3: "TWN", continent: "Asia", subregion: "Eastern Asia" },
  383: { name: "Kosovo", iso3: "XKX", continent: "Europe", subregion: "Southern Europe" },
  732: { name: "Western Sahara", iso3: "ESH", continent: "Africa", subregion: "Northern Africa" },
  275: { name: "Palestine", iso3: "PSE", continent: "Asia", subregion: "Western Asia" },
};

function numId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function continentOf(region, subregion) {
  if (region === "Africa") return "Africa";
  if (region === "Europe") return "Europe";
  if (region === "Asia") return "Asia";
  if (region === "Oceania") return "Oceania";
  if (region === "Americas") {
    return subregion === "South America" ? "South America" : "North America";
  }
  if (region === "Antarctic") return "Antarctica";
  return "Other";
}

if (!existsSync(namesPath)) {
  console.log("Downloading", NAMES_URL);
  const res = await fetch(NAMES_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  mkdirSync(dirname(namesPath), { recursive: true });
  writeFileSync(namesPath, Buffer.from(await res.arrayBuffer()));
}

const names = JSON.parse(readFileSync(namesPath, "utf8"));
const byCode = new Map();
for (const country of names) {
  const id = numId(country.ccn3);
  if (id == null) continue;
  byCode.set(id, country);
}

const atlas = JSON.parse(
  readFileSync(resolve(root, "node_modules/world-atlas/countries-50m.json"), "utf8"),
);
const out = [];
const unmatched = [];
for (const geometry of atlas.objects.countries.geometries) {
  const id = numId(geometry.id);
  if (id == null) {
    unmatched.push(geometry.id);
    continue;
  }
  const hit = byCode.get(id);
  const manual = MANUAL[id];
  if (!hit && !manual) {
    unmatched.push(id);
    continue;
  }
  const region = hit?.region ?? "";
  const subregion = manual?.subregion ?? hit?.subregion ?? "";
  out.push({
    id: String(id),
    name: manual?.name ?? hit.name.common,
    iso3: manual?.iso3 ?? hit.cca3,
    continent: manual?.continent ?? continentOf(region, subregion),
    subregion,
  });
}

const unique = [];
const seen = new Set();
for (const country of out) {
  if (seen.has(country.id)) continue;
  seen.add(country.id);
  unique.push(country);
}
unique.sort((a, b) => a.name.localeCompare(b.name));
const dest = resolve(root, "public/data/country-meta.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(unique, null, 2) + "\n");
console.log(`Wrote ${unique.length} countries. Unmatched ids: ${unmatched.join(", ") || "(none)"}`);
