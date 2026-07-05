import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedValuePct,
  rankAltLineByValue,
  selectBestAltLineByEv,
} from "./altLineEvSelect.ts";
import type { CloseGameSpreadRow } from "./closeGameSpreadSelect.ts";
import { isLongshotMainTicketQualified } from "./parlayQualifiedGate.ts";

const GAME = "Milwaukee Brewers @ Arizona Diamondbacks";

function row(
  market: string,
  pick: string,
  odds: number,
  edge: number,
  winProb: number,
): CloseGameSpreadRow {
  const qualified = isLongshotMainTicketQualified(
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

test("selectBestAltLineByEv picks highest EV close-sim line, not forced -1.5", () => {
  const best = selectBestAltLineByEv(
    [
      row("Spread", "Brewers -1.5", -154, 0.4, 0.5),
      row("Alt Spread", "Brewers +1.5", -130, 1.8, 0.58),
      row("Moneyline", "Brewers ML", -105, 1.2, 0.52),
    ],
    { qualify: (score, odds, edge) => isLongshotMainTicketQualified(score, odds, edge) },
  );
  assert.match(best?.entry.pick ?? "", /\+1\.5/);
});

test("selectBestAltLineByEv allows 49-50% sim when EV and edge are best", () => {
  const best = selectBestAltLineByEv(
    [
      row("Alt Spread", "Brewers +1.5", 120, 2.5, 0.49),
      row("Spread", "Brewers +1.5", -110, 0.5, 0.49),
    ],
    { qualify: (score, odds, edge) => isLongshotMainTicketQualified(score, odds, edge) },
  );
  assert.ok(best != null);
  assert.equal(best?.entry.odds, 120);
});

test("rankAltLineByValue breaks ties toward higher payout", () => {
  const a = row("Alt Spread", "Brewers +1.5", -130, 2.0, 0.55);
  const b = row("Alt Spread", "Brewers +1.5", 110, 2.0, 0.55);
  assert.ok(rankAltLineByValue(a, b) > 0);
});
