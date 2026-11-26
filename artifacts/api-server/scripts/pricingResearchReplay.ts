import { readFileSync } from "node:fs";
import { replayPricing } from "../src/lib/pricingResearch/replay.js";

const path = process.argv[2];
if (!path || path === "--help") {
  console.log("Usage: node --import ./artifacts/api-server/test/register-hooks.mjs artifacts/api-server/scripts/pricingResearchReplay.ts <captured-records.jsonl>");
  console.log("Provide one pregame, settled research record per line: fair, receptions, receiving_yards, sgp, or sgp_script.");
  process.exit(path ? 0 : 1);
}
const rows = readFileSync(path, "utf8").split(/\r?\n/).flatMap((line, index) => {
  if (!line.trim()) return [];
  try {
    return [JSON.parse(line)];
  } catch {
    throw new SyntaxError(`Invalid JSON on line ${index + 1}`);
  }
});
if (!rows.length) throw new RangeError("No captured records");
console.log(JSON.stringify(replayPricing(rows), null, 2));
