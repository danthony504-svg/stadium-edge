import { readFileSync } from "node:fs";
import { backtestNbaPossessions } from "../src/lib/sportSim/nbaPossessionBacktest.js";

const file = process.argv[2];
if (!file) throw new Error("Pass a JSONL file of timestamped NBA snapshots and settled results");
const rows = readFileSync(file, "utf8").split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
console.log(JSON.stringify(backtestNbaPossessions(rows), null, 2));
