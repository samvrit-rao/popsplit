import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/world-atlas/countries-50m.json");
const dest = resolve(root, "public/data/countries-50m.json");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("Copied Natural Earth 1:50m countries to public/data/countries-50m.json");
