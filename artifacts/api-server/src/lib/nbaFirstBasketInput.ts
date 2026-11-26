import { readFile, stat } from "node:fs/promises";
import { createSingleFlight } from "./singleFlight.js";
import type { FirstBasketSnapshot, OpeningGame } from "./nbaFirstBasketModel.js";

export type FirstBasketCapture = { snapshots: FirstBasketSnapshot[]; history: OpeningGame[] };
let capture: { path: string; modified: number; value: FirstBasketCapture } | undefined;
const captureFlight = createSingleFlight();

export async function readFirstBasketCapture() {
  const path = process.env.NBA_FIRST_BASKET_CAPTURE;
  if (!path) return null;
  return captureFlight(path, async () => {
    const info = await stat(path);
    if (info.size > 20_000_000) throw new RangeError("First Basket capture too large");
    if (capture?.path !== path || capture.modified !== info.mtimeMs) {
      const value: FirstBasketCapture = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(value?.snapshots) || !Array.isArray(value.history)) throw new TypeError("Invalid First Basket capture");
      capture = { path, modified: info.mtimeMs, value };
    }
    return capture.value;
  });
}
