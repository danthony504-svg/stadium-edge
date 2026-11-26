import { readFile } from "node:fs/promises";
import { captureOpeningGame } from "../src/lib/nbaFirstBasketCapture.js";
import { validateFirstBasketSnapshot, type FirstBasketSnapshot } from "../src/lib/nbaFirstBasketModel.js";

const path = process.argv[2];
if (!path) throw new Error("Pass the trusted capture file with snapshots and finalized opening play feeds");
const input = JSON.parse(await readFile(path, "utf8")) as {
  snapshots: FirstBasketSnapshot[];
  games: Parameters<typeof captureOpeningGame>[0][];
};
if (!Array.isArray(input.snapshots) || !input.snapshots.every(validateFirstBasketSnapshot) || !Array.isArray(input.games)) {
  throw new TypeError("Invalid First Basket source file");
}
const history = input.games.map(captureOpeningGame);
if (history.some(game => game === null)) throw new Error("At least one opening feed could not be verified");
console.log(JSON.stringify({ snapshots: input.snapshots, history }));
