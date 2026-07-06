import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameLineSelectionReason,
  expectedValuePct,
  rankGameLineByEv,
  selectBestGameLineByEv,
  gameLineRowQualifies,
} from "./altLineEvSelect.ts";
import type { CloseGameSpreadRow } from "./closeGameSpreadSelect.ts";
import { isGameLineMainTicketQualified } from "./parlayQualifiedGate.ts";

const GAME = "Milwaukee Brewers @ Arizona Diamondbacks";

function row(
  market: string,
  pick: string,
  odds: number,
  edge: number,
  winProb: number,
): CloseGameSpreadRow {
  const ev = expectedValuePct(winProb, odds, null, edge);
  const qualified = isGameLineMainTicketQualified(
    {
      composite: 7,
      grade: "C+",
      confidencePct: 55,
      edgePct: edge,
      simHit: winProb,
      simAligned: winProb >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: edge },
    },
    odds,
    edge,
    ev,
    { evPct: ev, bookSpread: null, finalAiScore: undefined },
  );
  return {
    entry: { sport: "mlb", game: GAME, market, pick, odds, edge },
    finalAiScore: {
      composite: 7,
      grade: "C+",
      confidencePct: 55,
      edgePct: edge,
      simHit: winProb,
      simAligned: winProb >= 0.52,
      highRiskValuePlay: false,
      recommends: qualified,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "C+", confidencePct: 55, edgePct: edge },
    },
    winProb,
    edgePct: edge,
  };
}

test("expectedValuePct uses win probability and american odds", () => {
  const ev = expectedValuePct(0.5, 110, null, 2);
  assert.ok(ev != null && ev > 0);
});

test("selectBestGameLineByEv picks highest Final Score line, not forced -1.5", () => {
  const best = selectBestGameLineByEv([
    row("Spread", "Brewers -1.5", -154, 0.4, 0.5),
    row("Alt Spread", "Brewers +1.5", -130, 1.8, 0.58),
    row("Moneyline", "Brewers ML", -105, 1.2, 0.52),
  ]);
  assert.match(best?.entry.pick ?? "", /\+1\.5/);
});

test("selectBestGameLineByEv skips sub-50% sim without exceptional edge", () => {
  const low = selectBestGameLineByEv([
    row("Spread", "Mariners +1.5", -110, 1.2, 0.49),
    row("Alt Spread", "Mariners +2.5", 120, 1.0, 0.56),
  ]);
  assert.match(low?.entry.pick ?? "", /\+2\.5/);
});

test("gameLineRowQualifies rejects sub-50% sim without exceptional edge", () => {
  const bad = row("Spread", "Mariners +1.5", -110, 1.2, 0.49);
  assert.equal(gameLineRowQualifies(bad), false);
});

test("buildGameLineSelectionReason lists EV edge and sim approval bullets", () => {
  const main = row("Spread", "Brewers -1.5", -154, 0.4, 0.5);
  const alt = row("Alt Spread", "Brewers +1.5", -130, 1.8, 0.58);
  const reason = buildGameLineSelectionReason(alt, [main, alt], main);
  assert.match(reason, /Highest EV/i);
  assert.match(reason, /\+1\.8% edge/i);
  assert.match(reason, /Simulation favorite/i);
});

test("rankGameLineByEv breaks ties toward higher payout", () => {
  const a = row("Alt Spread", "Brewers +1.5", -130, 2.0, 0.55);
  const b = row("Alt Spread", "Brewers +1.5", 110, 2.0, 0.55);
  assert.ok(rankGameLineByEv(a, b) > 0);
});
