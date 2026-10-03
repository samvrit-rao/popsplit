import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feature } from "topojson-client";
import { lonSpanOf } from "../src/game/bounds.ts";
import { hasMiddleWater, landFraction } from "../src/game/landShare.ts";
import { frameOfFit, osmViewFor } from "../src/game/mapFrame.ts";
import type { GeoCollection, GeoFeature } from "../src/game/types.ts";

const maliSouth: GeoFeature = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [[
      [-8.2, 10.2],
      [-8.2, 15.6],
      [-1.4, 15.6],
      [-1.4, 10.2],
      [-8.2, 10.2],
    ]],
  },
};

const frame = frameOfFit(maliSouth, []);
assert.ok(frame.west <= -8 && frame.east >= -1.4, `frame lon ${frame.west}..${frame.east}`);
assert.ok(frame.south <= 10.3 && frame.north >= 15.5, `frame lat ${frame.south}..${frame.north}`);
assert.equal(frame.wraps, false);

const view = osmViewFor(frame, 1100, 720);
assert.ok(view.lat > frame.south && view.lat < frame.north, `center lat ${view.lat}`);
assert.ok(view.lon > frame.west && view.lon < frame.east, `center lon ${view.lon}`);
assert.ok(view.zoom > 5 && view.zoom < 10, `zoom ${view.zoom}`);

const world = 256 * 2 ** view.zoom;
const framePx = ((frame.east - frame.west) / 360) * world;
assert.ok(framePx < 1100 - 36, `frame should sit inside the map, width ${framePx}`);
assert.ok(framePx > 420, `frame should stay the subject, width ${framePx}`);

const wrapped = osmViewFor({ west: 170, south: -18, east: -168, north: -12, wraps: true }, 1000, 640);
assert.ok(Math.abs(wrapped.lon) > 165, `dateline center ${wrapped.lon}`);
assert.ok(wrapped.zoom > 3 && wrapped.zoom < 9, `dateline zoom ${wrapped.zoom}`);

const tiny = frameOfFit({
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[[103.8, 1.3], [103.8, 1.32], [103.82, 1.32], [103.82, 1.3], [103.8, 1.3]]] },
}, []);
const city = osmViewFor(tiny, 900, 600);
assert.ok(city.zoom <= 16 && city.zoom >= 2, `tiny zoom ${city.zoom}`);
assert.ok(Math.abs(city.lon - 103.81) < 0.2, `tiny lon ${city.lon}`);

const oceanFit: GeoFeature = {
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[[15, -40], [32, -40], [32, -22], [15, -22], [15, -40]]] },
};
const land: GeoFeature = {
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[[16, -33], [31, -33], [31, -23], [16, -23], [16, -33]]] },
};
const coast = frameOfFit(oceanFit, [
  { lon: 18, lat: -26, pop: 1000 },
  { lon: 28, lat: -30, pop: 1000 },
], land);
assert.ok(coast.south > -34.5, `ocean frame should stop near the coast, south ${coast.south}`);
assert.ok(coast.south < -32, `coast stays inside the frame, south ${coast.south}`);
assert.ok(osmViewFor(coast, 1100, 720).zoom >= 4, "coastal close-up should be zoomed in");

const fijiLike: GeoCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[
        [180, -16.54],
        [179.98, -16.54],
        [-180, -16.49],
        [-179.9, -16.43],
        [-180, -16.54],
        [180, -16.54],
      ]] },
    },
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[177.2, -18.2], [178.5, -18.2], [178.5, -17.3], [177.2, -17.3], [177.2, -18.2]]] },
    },
  ],
};
const fijiFrame = frameOfFit(fijiLike, [
  { lon: 177.8, lat: -17.8, pop: 1000 },
  { lon: 178.4, lat: -18.0, pop: 1000 },
], fijiLike);
const fijiSpan = lonSpanOf(fijiFrame);
assert.ok(fijiSpan < 20, `Fiji-like span ${fijiSpan}`);
const fijiView = osmViewFor(fijiFrame, 1280, 800);
assert.ok(fijiView.zoom >= 5, `Fiji-like zoom ${fijiView.zoom}`);
assert.ok(fijiView.lon > 170 || fijiView.lon < -170, `Fiji-like center ${fijiView.lon}`);

const atlas = JSON.parse(readFileSync("public/data/countries-50m.json", "utf8"));
const countries = feature(atlas, atlas.objects.countries);
const fiji = countries.features.find((item) => String(item.id) === "242");
assert.ok(fiji, "missing Fiji");
const fijiReal = frameOfFit({ type: "FeatureCollection", features: [fiji!] }, [
  { lon: 178.2, lat: -17.8, pop: 1000 },
], { type: "FeatureCollection", features: [fiji!] });
assert.ok(lonSpanOf(fijiReal) < 30, `real Fiji span ${lonSpanOf(fijiReal)}`);
assert.ok(lonSpanOf(fijiReal) > 0.8, `real Fiji should frame an island, span ${lonSpanOf(fijiReal)}`);
assert.ok(osmViewFor(fijiReal, 1280, 800).zoom >= 5, `real Fiji zoom ${osmViewFor(fijiReal, 1280, 800).zoom}`);

const states = JSON.parse(readFileSync("public/data/us-states.json", "utf8")) as GeoCollection;
const california = states.features.find((item) => item.properties?.name === "California");
const alaska = states.features.find((item) => item.properties?.name === "Alaska");
assert.ok(california && alaska, "missing state outlines");
const californiaFrame = frameOfFit({ type: "FeatureCollection", features: [california!] }, [], { type: "FeatureCollection", features: [california!] });
const alaskaFrame = frameOfFit({ type: "FeatureCollection", features: [alaska!] }, [], { type: "FeatureCollection", features: [alaska!] });
assert.ok(lonSpanOf(californiaFrame) < 15, `California span ${lonSpanOf(californiaFrame)}`);
assert.ok(osmViewFor(californiaFrame, 1100, 720).zoom >= 5, "California should be zoomed in");
assert.ok(lonSpanOf(alaskaFrame) < 70, `Alaska span ${lonSpanOf(alaskaFrame)}`);
assert.ok(osmViewFor(alaskaFrame, 1100, 720).zoom >= 3, "Alaska should not be a world view");

function square(west: number, south: number, east: number, north: number, hole?: [number, number, number, number]): GeoFeature {
  // d3-geo treats a clockwise ring as the exterior.
  const outer = [[west, south], [west, north], [east, north], [east, south], [west, south]];
  const coordinates = [outer];
  if (hole) {
    const [hw, hs, he, hn] = hole;
    coordinates.push([[hw, hs], [he, hs], [he, hn], [hw, hn], [hw, hs]]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } };
}

const sweden = square(17, 60, 20, 66);
const finland = square(23, 60, 26, 66);
const bothniaDraw: GeoCollection = { type: "FeatureCollection", features: [sweden, finland] };
const bothniaFit = square(16, 59, 28, 67);
const bothnia = frameOfFit(bothniaFit, [
  { lon: 18, lat: 62, pop: 8000 },
  { lon: 18.4, lat: 64, pop: 6000 },
  { lon: 24.2, lat: 63, pop: 400 },
], bothniaDraw);
assert.ok(bothnia.east < 21.6, `Gulf of Bothnia frame should stay on the Swedish side, east ${bothnia.east}`);
assert.ok(bothnia.west > 15 && bothnia.west < 19, `Swedish side west ${bothnia.west}`);
assert.ok(landFraction(bothniaDraw, bothnia) >= 0.5, `Bothnia land share ${landFraction(bothniaDraw, bothnia)}`);
assert.equal(hasMiddleWater(bothniaDraw, bothnia), false, "Bothnia frame still has water through the middle");

const lake = square(0, 0, 12, 10, [5, 0.4, 7.2, 9.6]);
const lakeFrame = frameOfFit(lake, [
  { lon: 2, lat: 5, pop: 4000 },
  { lon: 3, lat: 6, pop: 4000 },
  { lon: 9, lat: 5, pop: 200 },
], lake);
assert.ok(lakeFrame.west < 1 && lakeFrame.east < 7.1 && lakeFrame.east > 4, `lake should stay on the left shore, ${lakeFrame.west}..${lakeFrame.east}`);
assert.ok(lakeFrame.east - lakeFrame.west < 8, `lake frame should not span both shores, span ${lakeFrame.east - lakeFrame.west}`);
assert.equal(hasMiddleWater(lake, lakeFrame), false);
assert.ok(landFraction(lake, lakeFrame) >= 0.5, `lake land share ${landFraction(lake, lakeFrame)}`);

const coastLand = square(0, 0, 10, 6);
const coastFit = square(0, 0, 10, 11);
const coastFrame = frameOfFit(coastFit, [
  { lon: 2, lat: 2, pop: 1000 },
  { lon: 8, lat: 4, pop: 1000 },
], coastLand);
assert.ok(coastFrame.south < 1 && coastFrame.north > 5 && coastFrame.north < 8, `coastline frame ${coastFrame.south}..${coastFrame.north}`);
assert.equal(hasMiddleWater(coastLand, coastFrame), false);
assert.ok(landFraction(coastLand, coastFrame) >= 0.5, `coast land share ${landFraction(coastLand, coastFrame)}`);

console.log(`map frame ok  maliZoom=${view.zoom.toFixed(2)}  framePx=${framePx.toFixed(0)}  fijiZoom=${fijiView.zoom.toFixed(2)}  fijiSpan=${fijiSpan.toFixed(1)}  bothnia=${bothnia.west.toFixed(1)}..${bothnia.east.toFixed(1)}`);
