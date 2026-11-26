import { readFileSync } from "node:fs";
import { backtestEventSim } from "../src/lib/sportSim/eventSimBacktest.js";
import { backtestNbaPossessions } from "../src/lib/sportSim/nbaPossessionBacktest.js";

const file = process.argv[2];
if (!file) throw new Error("Pass a JSONL file of pregame snapshots and independently settled results");
const rows = readFileSync(file, "utf8").split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
const basketball = rows.filter(r => r.snapshot.sport === "nba" || r.snapshot.sport === "wnba");
const output = backtestEventSim(rows.filter(r => r.snapshot.sport !== "nba" && r.snapshot.sport !== "wnba"));
console.log(JSON.stringify([
  ...output,
  ...(["nba", "wnba"] as const).flatMap(sport => {
    const games = basketball.filter(r => r.snapshot.sport === sport);
    return games.length ? [{ sport, ...backtestNbaPossessions(games) }] : [];
  }),
], null, 2));
