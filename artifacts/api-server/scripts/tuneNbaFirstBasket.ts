import { readFile } from "node:fs/promises";
import { tuneFirstBasketUsage } from "../src/lib/nbaFirstBasketTuneUsage.js";

const path = process.argv[2];
if (!path) throw new Error("Pass a JSON file with verified history and chronological evaluation games");
const input = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof tuneFirstBasketUsage>[0];
console.log(JSON.stringify(tuneFirstBasketUsage(input), null, 2));
