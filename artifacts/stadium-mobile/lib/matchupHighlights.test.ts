import test from "node:test";
import assert from "node:assert/strict";
import { matchupHighlights } from "./matchupHighlights.ts";
test("exact-market defense and run context remain visible alongside player form",()=>{
 const rows=matchupHighlights(["Exact-market history: 285.3 average; 5/6 hit Over 255.5 (last 6 dated games).","Green Bay: 208.0 pass yds/game (opposing team production allowed; based on 7 games; dated source)."],"Green Bay: 125.0 rush yds/game (opposing team production allowed; based on 7 games; dated source).");
 assert.equal(rows.length,3);assert.ok(rows[1]!.includes("208.0")&&rows[1]!.includes("7 games"));assert.ok(rows[2]!.includes("125.0"));assert.ok(!rows.join(" ").includes("will pass"));
});
test("missing defense stays explicit and is not replaced by the player's average",()=>{
 assert.ok(matchupHighlights(["Exact-market history: 285.3 average; 5/6 hit Over 255.5."])[1]!.includes("unavailable"));
});
test("position threshold observations retain the game denominator warning",()=>{
 assert.ok(matchupHighlights(["Opponent allowed at least one opposing guard to exceed 4.5 threes in 2/4 completed games with complete verified records."])[1]!.includes("Each game counts once"));
});
