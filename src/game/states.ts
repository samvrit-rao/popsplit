import { cellsInside } from "./land.ts";
import { sumPop } from "./population.ts";
import type { PopGrid } from "./population.ts";
import type { Cell, GeoCollection, GeoFeature, Round } from "./types.ts";

export type StateShape = {
  id: string;
  name: string;
  feature: GeoFeature;
  cells: Cell[];
  pop: number;
};

export function buildStates(collection: GeoCollection, grid: PopGrid): StateShape[] {
  const states: StateShape[] = [];
  for (const feature of collection.features) {
    const name = String(feature.properties?.name ?? "").trim();
    if (!name || !feature.geometry) continue;
    const cells = cellsInside(grid, feature, null);
    states.push({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name,
      feature,
      cells,
      pop: sumPop(cells),
    });
  }
  states.sort((a, b) => a.name.localeCompare(b.name));
  return states;
}

export function stateRound(state: StateShape): Round {
  const draw: GeoCollection = { type: "FeatureCollection", features: [state.feature] };
  return {
    id: `state-${state.id}`,
    name: state.name,
    detail: null,
    continent: "North America",
    scale: "state",
    draw,
    fit: draw,
    cells: state.cells,
  };
}
