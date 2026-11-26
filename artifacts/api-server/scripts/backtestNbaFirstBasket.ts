import { readFile } from "node:fs/promises";
import { backtestNbaFirstBasket } from "../src/lib/nbaFirstBasketBacktest.js";

const path = process.argv[2];
if (!path) throw new Error("Pass a JSON file with pregame snapshots, verified finals and optional closing fields");
const input = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof backtestNbaFirstBasket>[0];
const includeClosing = process.argv.includes("--closing");
const result = backtestNbaFirstBasket({ ...input, includeClosing });
console.log(JSON.stringify(includeClosing ? result : { suppliedGames: result.suppliedGames, skipped: result.skipped, stage1: result.stage1 }, null, 2));
