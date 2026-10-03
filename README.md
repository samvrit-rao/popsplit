# PopSplit

PopSplit is a daily geography puzzle you play in the browser. A round shows one real place — a country, a piece of a continent, or a close-up inside a country — clipped to its coastline. You cut that map so the people are divided as evenly as you can.

- **Halves** — one straight line, aiming at 50/50.
- **Thirds** — a movable center and three spokes, aiming at about 33% each.
- **Quarters** — two lines locked at a right angle, aiming at 25% each.

Percentages stay hidden while you drag. **Lock in** reveals the share of each piece, a color for each piece, and a dashed green line: the best single adjustment from the cut you actually drew. The daily game is three rounds. Unlimited zooms into part of a country. Country lets you search or pick at random, and States does the same for US states.

Scores, streaks, and the histogram live in `localStorage`. There is no account. Each round is an [OpenStreetMap](https://www.openstreetmap.org/copyright) basemap (Leaflet tiles from `tile.openstreetmap.org`). The frame is the land being scored, zoomed to that place. Population still decides the score and stays hidden until you lock in. Country coastlines are Natural Earth. State outlines are Natural Earth admin-1.

## Run locally

```bash
npm install
npm run dev
```

`npm install` copies Natural Earth 1:50m country borders from the `world-atlas` package into `public/data/`. The population grid is already in the repo, so the game starts without a manual download. Open the URL Vite prints (the dev server in this project uses port 5199).

```bash
npm test
```

`npm run test:score` checks the scoring function: a perfect split scores 100, and a badly uneven split scores much lower. `npm run test:data` rebuilds the region pool and checks that a date plus a mode name always deals the same three rounds, across at least two continents and three map scales.

## Static deploy

```bash
npm run build
```

Upload the `dist/` folder to any static host (Netlify, Cloudflare Pages, GitHub Pages, S3). The site is one page with hash routes, so the host does not need a rewrite rule. For a host that serves the site from a subpath, set `base` in `vite.config.ts` before building.

Preview the production build locally:

```bash
npx serve dist
```

## How a daily puzzle is chosen

The date is the player's local calendar day, `YYYY-MM-DD`. The seed is that string plus the mode name (`Halves`, `Thirds`, or `Quarters`), hashed into [mulberry32](https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32). Everyone on the same local date gets the same three places for a mode. The three rounds use a country, a multi-country region, and a close-up, and they cover at least two continents. A new puzzle starts at local midnight.

## Scoring

All of the math lives in `src/game/scoring.ts`:

```text
deviation = sum of |actual share − target share|
linear    = max(0, 1 − deviation / 0.5)
eased     = 1 − (1 − linear)²
score     = round(100 × eased)
```

A perfect split scores 100. The ease-out keeps a near miss in the 90s instead of dropping it on a straight line. The same function scores every mode.

## Data

Borders are [Natural Earth](https://www.naturalearthdata.com/) admin-0 countries at 1:50m, loaded from the [`world-atlas`](https://github.com/topojson/world-atlas) npm package (also published at `https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json`). `npm install` copies `countries-50m.json` into `public/data/`. Disputed borders are whatever that dataset draws. Country names and UN subregions come from [mledoze/countries](https://github.com/mledoze/countries). Regenerate the name table with:

```bash
npm run data:meta
```

That command expects `data/raw/countries.json`, or it downloads:

```bash
curl -L -o data/raw/countries.json \
  https://raw.githubusercontent.com/mledoze/countries/master/countries.json
```

### Population grid the app ships with

The committed grid is **not** a census raster. It is Natural Earth populated places: each city's `POP_MAX`, summed into the 0.25° cell that contains it. If that cell's center falls in the ocean, the count is moved to the nearest cell center within 0.75° that sits inside the same coastline. Rural population is missing, so empty countryside is empty on purpose. The file is a dense Float32 grid, about 4.1 MB, plus `public/data/population.json` (bounds, cell size, width, height, and the source note).

Regenerate it:

```bash
npm run data:places
```

The script downloads and unzips:

- Page: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/
- File: https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip

`unzip` needs to be on your PATH. Raw downloads stay in `data/raw/` and are not committed.

### Preferred raster: GPWv4 (or another population-count GeoTIFF)

[GPWv4](https://sedac.ciesin.columbia.edu/data/set/gpw-v4-population-count-rev11) revision 11 is a real population-count raster. The 15 arc-minute (0.25°) 2020 GeoTIFF is the file this repo knows how to ingest. [WorldPop](https://www.worldpop.org/) global mosaics are the other usual source, but the 1 km world file is too large for this script; a count GeoTIFF under about 8 million pixels can be aggregated with the same command.

SEDAC sometimes asks for a free Earthdata login, and the direct URL can time out. When you have the file:

```bash
mkdir -p data/raw
curl -L --fail -o data/raw/gpw.zip \
  "https://sedac.ciesin.columbia.edu/downloads/data/gpw-v4/gpw-v4-population-count-rev11/gpw-v4-population-count-rev11_2020_15_min_tif.zip"
unzip -p data/raw/gpw.zip "*.tif" > data/raw/gpw.tif
npm run data:gpw
```

`npm run data:gpw` sums population counts into a 0.25° Float32 grid and overwrites `public/data/population.json` and `population.bin`. The game reads whichever header is there, and the stats page quotes `sourceDetail` from that header. Restart `npm run dev` after replacing the grid.

Cells are counted inside a round when their centers fall inside the region polygon (`d3.geoContains`). That list is cached for the rest of the session.
