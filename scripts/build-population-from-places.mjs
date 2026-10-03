/**
 * Aggregate Natural Earth populated places into a 0.25° Float32 population grid.
 *
 * Download (public domain):
 *   https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip
 * Page:
 *   https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/
 *
 * Each place contributes its POP_MAX. If the 0.25° cell center that contains the
 * city falls outside the Natural Earth coastline, the count is moved to the nearest
 * cell center within 0.75° that sits inside the same polygon. Counts are never
 * invented, split, or spread with a kernel.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoBounds, geoContains } from "d3-geo";
import { feature } from "topojson-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = resolve(root, "data/raw");
const zipPath = resolve(rawDir, "ne_10m_populated_places.zip");
const dbfPath = resolve(rawDir, "ne_10m_populated_places.dbf");
const ZIP_URL =
  "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip";

const CELL = 0.25;
const WEST = -180;
const SOUTH = -90;
const WIDTH = Math.round(360 / CELL);
const HEIGHT = Math.round(180 / CELL);

async function ensureDbf() {
  mkdirSync(rawDir, { recursive: true });
  if (existsSync(dbfPath)) return;
  if (!existsSync(zipPath)) {
    console.log("Downloading", ZIP_URL);
    const res = await fetch(ZIP_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", rawDir], { stdio: "inherit" });
  if (!existsSync(dbfPath)) throw new Error("DBF missing after unzip");
}

function readDbf(path) {
  const data = readFileSync(path);
  const nrec = data.readInt32LE(4);
  const headerLen = data.readUInt16LE(8);
  const recLen = data.readUInt16LE(10);
  const fields = [];
  let o = 32;
  while (data[o] !== 0x0d) {
    const name = data.subarray(o, o + 11).toString("ascii").replace(/\0/g, "").trim();
    fields.push({ name, len: data[o + 16] });
    o += 32;
  }
  const rows = [];
  for (let i = 0; i < nrec; i++) {
    const off = headerLen + i * recLen;
    if (data[off] === 0x2a) continue;
    let foff = off + 1;
    const row = {};
    for (const field of fields) {
      row[field.name] = data.subarray(foff, foff + field.len).toString("latin1").trim();
      foff += field.len;
    }
    rows.push(row);
  }
  return rows;
}

function num(value) {
  if (!value || value.includes("*")) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function lonInRange(lon, west, east) {
  if (west <= east) return lon >= west && lon <= east;
  return lon >= west || lon <= east;
}

function loadLand() {
  const atlas = JSON.parse(
    readFileSync(resolve(root, "node_modules/world-atlas/countries-50m.json"), "utf8"),
  );
  return feature(atlas, atlas.objects.countries)
    .features.filter((item) => item.geometry)
    .map((item) => ({ feature: item, bounds: geoBounds(item) }));
}

function countryAt(land, lon, lat) {
  for (const item of land) {
    const [[west, south], [east, north]] = item.bounds;
    if (lat < south || lat > north || !lonInRange(lon, west, east)) continue;
    if (geoContains(item.feature, [lon, lat])) return item;
  }
  return null;
}

function cellOf(lon, lat) {
  let col = Math.floor((lon - WEST) / CELL);
  let row = Math.floor((lat - SOUTH) / CELL);
  if (col === WIDTH) col = WIDTH - 1;
  if (row === HEIGHT) row = HEIGHT - 1;
  return [col, row];
}

function centerOf(col, row) {
  return [WEST + (col + 0.5) * CELL, SOUTH + (row + 0.5) * CELL];
}

await ensureDbf();
const land = loadLand();
const sums = new Float64Array(WIDTH * HEIGHT);
let places = 0;
let snapped = 0;
let dropped = 0;

for (const row of readDbf(dbfPath)) {
  const pop = num(row.POP_MAX);
  const lon = num(row.LONGITUDE);
  const lat = num(row.LATITUDE);
  if (pop <= 0 || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    dropped++;
    continue;
  }
  const home = countryAt(land, lon, lat);
  let [col, rowIndex] = cellOf(lon, lat);
  let [clon, clat] = centerOf(col, rowIndex);
  const insideHome = (x, y) => (home ? geoContains(home.feature, [x, y]) : countryAt(land, x, y));
  if (!insideHome(clon, clat)) {
    let best = null;
    let bestD = Infinity;
    for (let dc = -3; dc <= 3; dc++) {
      for (let dr = -3; dr <= 3; dr++) {
        const c = col + dc;
        const r = rowIndex + dr;
        if (c < 0 || r < 0 || c >= WIDTH || r >= HEIGHT) continue;
        const [x, y] = centerOf(c, r);
        if (!insideHome(x, y)) continue;
        const d = (x - lon) ** 2 + (y - lat) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [c, r];
        }
      }
    }
    if (!best) {
      dropped++;
      continue;
    }
    [col, rowIndex] = best;
    snapped++;
  }
  sums[rowIndex * WIDTH + col] += pop;
  places++;
}

const out = new Float32Array(WIDTH * HEIGHT);
let total = 0;
let nonzero = 0;
for (let i = 0; i < sums.length; i++) {
  if (sums[i] <= 0) continue;
  out[i] = sums[i];
  total += sums[i];
  nonzero++;
}

const header = {
  source: "Natural Earth 10m populated places",
  sourceDetail:
    "POP_MAX for each populated place, summed into a 0.25° cell. If that cell's center falls outside the coast, the count moves to the nearest inland cell center within 0.75°. Rural population is not included. This is the bundled fallback, not a census raster.",
  sourceUrl:
    "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/",
  downloadUrl: ZIP_URL,
  license: "Natural Earth public domain",
  bounds: [WEST, SOUTH, WEST + WIDTH * CELL, SOUTH + HEIGHT * CELL],
  cellSize: CELL,
  width: WIDTH,
  height: HEIGHT,
  encoding: "float32",
  scale: 1,
  rowOrigin: "south",
  nonzeroCells: nonzero,
  totalPopulation: Math.round(total),
  placesUsed: places,
  placesSnappedInland: snapped,
  placesSkipped: dropped,
};

const outDir = resolve(root, "public/data");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "population.json"), JSON.stringify(header, null, 2) + "\n");
writeFileSync(resolve(outDir, "population.bin"), Buffer.from(out.buffer));
console.log(
  `Wrote ${nonzero} cells from ${places} places (${snapped} snapped inland, ${dropped} skipped). Total ${Math.round(total)}. Bin ${(out.byteLength / 1e6).toFixed(2)} MB.`,
);
