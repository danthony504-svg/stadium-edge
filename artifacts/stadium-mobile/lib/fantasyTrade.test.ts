import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFantasyTrade } from "./fantasyTrade.ts";
import { defaultFantasyRoster, createDefaultFantasyRosters, type FantasyRosterPlayer } from "./fantasyRoster.ts";

const player = (id: string, position = "WR"): FantasyRosterPlayer => ({ athleteId: id, name: id, team: "NFL", position, rosterSlot: "Bench", dateAdded: 1 });
const roster = defaultFantasyRoster(createDefaultFantasyRosters());
const analysis = (rows: Record<string, number>) => Object.fromEntries(Object.entries(rows).map(([id, recentAverage]) => [id, { recentAverage }])) as never;

test("one-for-one uses recorded scoring-format analysis and recent production", () => {
  const result = analyzeFantasyTrade({ give: [player("give")], receive: [player("receive")], roster, analysis: analysis({ give: 12, receive: 15 }), injuries: {} });
  assert.equal(result.verdict, "LEAN ACCEPT");
  assert.equal(result.receiveRecentPoints, 15);
});
test("multi-player trade aggregates supported recorded game logs", () => {
  const result = analyzeFantasyTrade({ give: [player("a"), player("b")], receive: [player("c")], roster, analysis: analysis({ a: 8, b: 9, c: 20 }), injuries: {} });
  assert.equal(result.verdict, "LEAN ACCEPT");
});
test("injury risk prevents fabricated accept certainty", () => {
  const result = analyzeFantasyTrade({ give: [player("give")], receive: [player("hurt")], roster, analysis: analysis({ give: 10, hurt: 20 }), injuries: { hurt: "Questionable" } });
  assert.equal(result.verdict, "CLOSE TRADE");
  assert.deepEqual(result.injuredPlayers, ["hurt"]);
});
test("missing game logs returns insufficient data", () => {
  const result = analyzeFantasyTrade({ give: [player("give")], receive: [player("missing")], roster, analysis: analysis({ give: 10 }), injuries: {} });
  assert.equal(result.verdict, "INSUFFICIENT DATA");
});
