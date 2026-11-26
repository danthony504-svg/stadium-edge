import { readFile } from "node:fs/promises";
import { replayFirstBasket, type FirstBasketReplay } from "../src/lib/nbaFirstBasketReplay.js";

const path = process.argv[2];
if (!path) throw new Error("Pass a First Basket replay JSON file");
const input = JSON.parse(await readFile(path, "utf8")) as FirstBasketReplay;
console.log(JSON.stringify(await replayFirstBasket(input), null, 2));
