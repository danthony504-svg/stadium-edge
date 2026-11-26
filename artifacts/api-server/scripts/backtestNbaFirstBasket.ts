import { readdir, readFile } from "node:fs/promises";
import { readFirstBasketArchiveDay } from "../src/lib/nbaFirstBasketArchive.js";
import { archivedFirstBasketCases, backtestNbaFirstBasket } from "../src/lib/nbaFirstBasketBacktest.js";
import type { OpeningGame } from "../src/lib/nbaFirstBasketModel.js";

const path = process.argv[2];
if (!path) throw new Error("Pass a JSON file with pregame snapshots and finals, or normalized history and --archive");
const input = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof backtestNbaFirstBasket>[0] & { finals?: OpeningGame[] };
const includeClosing = process.argv.includes("--closing");
const root = process.argv.includes("--archive") ? process.env.NBA_FIRST_BASKET_ARCHIVE_DIR : undefined;
if (process.argv.includes("--archive") && (!root || !Array.isArray(input.finals))) {
  throw new Error("Set NBA_FIRST_BASKET_ARCHIVE_DIR and supply verified history and finals arrays");
}
let cases = input.cases;
if (root) {
  const days = (await readdir(root)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day));
  const records = (await Promise.all(days.map(day => readFirstBasketArchiveDay(root, day)))).flat();
  cases = archivedFirstBasketCases(records, input.finals!);
}
const result = backtestNbaFirstBasket({ ...input, cases, includeClosing });
console.log(JSON.stringify(includeClosing ? result : { suppliedGames: result.suppliedGames, skipped: result.skipped, stage1: result.stage1 }, null, 2));
