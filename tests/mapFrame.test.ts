import assert from "node:assert/strict";
import { frameOfFit, osmViewFor } from "../src/game/mapFrame.ts";
import type { GeoFeature } from "../src/game/types.ts";

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

console.log(`map frame ok  maliZoom=${view.zoom.toFixed(2)}  framePx=${framePx.toFixed(0)}`);
