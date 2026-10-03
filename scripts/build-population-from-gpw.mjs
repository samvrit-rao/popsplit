/**
 * Build public/data/population.bin from a GPWv4 population-count GeoTIFF.
 *
 * Preferred input is the 15 arc-minute (0.25°) 2020 GeoTIFF. Finer rasters
 * up to about 8 million pixels are summed into 0.25° cells. Counts only —
 * nothing is modelled or invented here.
 *
 * Download (NASA SEDAC, account sometimes required):
 *   https://sedac.ciesin.columbia.edu/data/set/gpw-v4-population-count-rev11/data-download
 * Direct file used by this script:
 *   https://sedac.ciesin.columbia.edu/downloads/data/gpw-v4/gpw-v4-population-count-rev11/gpw-v4-population-count-rev11_2020_15_min_tif.zip
 *
 *   mkdir -p data/raw
 *   curl -L --fail -o data/raw/gpw.zip \
 *     "https://sedac.ciesin.columbia.edu/downloads/data/gpw-v4/gpw-v4-population-count-rev11/gpw-v4-population-count-rev11_2020_15_min_tif.zip"
 *   unzip -p data/raw/gpw.zip "*.tif" > data/raw/gpw.tif
 *   npm run data:gpw
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromFile } from "geotiff";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tifPath = resolve(root, "data/raw/gpw.tif");
const TARGET = 0.25;
const MAX_PIXELS = 8_000_000;

if (!existsSync(tifPath)) {
  console.error(`Missing ${tifPath}. See the comment at the top of this file for the download.`);
  process.exit(1);
}

const tiff = await fromFile(tifPath);
const image = await tiff.getImage();
const width = image.getWidth();
const height = image.getHeight();
if (width * height > MAX_PIXELS) {
  throw new Error(
    `Raster is ${width}x${height}. Use the 15 arc-minute GPWv4 file, or another grid under ${MAX_PIXELS} pixels.`,
  );
}

const [west, south, east, north] = image.getBoundingBox();
const rasters = await image.readRasters();
const values = rasters[0];
const noData = Number(image.getGDALNoData());
const pixelW = (east - west) / width;
const pixelH = (north - south) / height;

const outWest = -180;
const outSouth = -90;
const outWidth = Math.round(360 / TARGET);
const outHeight = Math.round(180 / TARGET);
const sums = new Float64Array(outWidth * outHeight);

function isNodata(value) {
  if (!Number.isFinite(value) || value <= 0) return true;
  if (Number.isFinite(noData) && Math.abs(value - noData) < 1e-3) return true;
  if (value > 1e12) return true;
  return false;
}

for (let row = 0; row < height; row++) {
  const lat = north - (row + 0.5) * pixelH;
  if (lat < -90 || lat > 90) continue;
  for (let col = 0; col < width; col++) {
    const value = values[row * width + col];
    if (isNodata(value)) continue;
    const lon = west + (col + 0.5) * pixelW;
    if (lon < -180 || lon > 180) continue;
    let oc = Math.floor((lon - outWest) / TARGET);
    let or = Math.floor((lat - outSouth) / TARGET);
    if (oc === outWidth) oc = outWidth - 1;
    if (or === outHeight) or = outHeight - 1;
    if (oc < 0 || or < 0 || oc >= outWidth || or >= outHeight) continue;
    sums[or * outWidth + oc] += value;
  }
}

let total = 0;
let nonzero = 0;
for (const value of sums) {
  if (value > 0) {
    nonzero++;
    total += value;
  }
}
const out = new Float32Array(outWidth * outHeight);
for (let i = 0; i < sums.length; i++) {
  if (sums[i] <= 0) continue;
  out[i] = sums[i];
}

const header = {
  source: "GPWv4 population count, revision 11",
  sourceDetail:
    "NASA SEDAC Gridded Population of the World v4.11 population counts, summed into 0.25° cells. Year follows the GeoTIFF you passed in (the documented file is 2020).",
  sourceUrl: "https://sedac.ciesin.columbia.edu/data/set/gpw-v4-population-count-rev11",
  downloadUrl:
    "https://sedac.ciesin.columbia.edu/downloads/data/gpw-v4/gpw-v4-population-count-rev11/gpw-v4-population-count-rev11_2020_15_min_tif.zip",
  license: "GPWv4 is distributed by NASA SEDAC. Cite CIESIN Columbia University.",
  bounds: [outWest, outSouth, outWest + outWidth * TARGET, outSouth + outHeight * TARGET],
  cellSize: TARGET,
  width: outWidth,
  height: outHeight,
  encoding: "float32",
  scale: 1,
  rowOrigin: "south",
  nonzeroCells: nonzero,
  totalPopulation: Math.round(total),
  inputRaster: { width, height, west, south, east, north, pixelW, pixelH },
};

const outDir = resolve(root, "public/data");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "population.json"), JSON.stringify(header, null, 2) + "\n");
writeFileSync(resolve(outDir, "population.bin"), Buffer.from(out.buffer));
console.log(
  `Wrote GPW grid: ${nonzero} cells, total ${Math.round(total)}, bin ${(out.byteLength / 1e6).toFixed(2)} MB.`,
);
