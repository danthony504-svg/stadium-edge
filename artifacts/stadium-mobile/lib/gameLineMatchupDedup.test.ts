import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import { dedupeToOneGameLinePerMatchup } from "./gameLineMatchupDedup.ts";
import { assertProductionCoachTicketIntegrity } from "./frozenGameLineConsistency.ts";
import { validateCoachTicket } from "./coachTicketValidation.ts";

const GAME = "Boston Red Sox @ Los Angeles Angels";

function gameLine(
  pick: string,
  market: string,
  odds: number,
  finalScore: number,
  grade = "B+",
): ParsedPick {
  const simHit = 0.5;
  return {
    game: GAME,
    market,
    pick,
    odds,
    isProp: false,
    gameLineFrozen: true,
    finalAiScore: {
      composite: finalScore,
      grade,
      confidencePct: 55,
      edgePct: 3.5,
      simHit,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: finalScore, grade, confidencePct: 55, edgePct: 3.5 },
    },
    gameLineFinal: {
      reason: "test",
      finalScore,
      frozenAt: 1,
      display: {
        pick,
        market,
        odds,
        game: GAME,
        grade,
        confidencePct: 55,
        edgePct: 3.5,
        evPct: 4.2,
        simHit,
        simPct: 50,
      },
      bullets: ["test"],
    },
  };
}

test("dedupeToOneGameLinePerMatchup keeps highest Final AI Score on opposing sides", () => {
  const angels = gameLine("Angels +1.5", "Spread", -110, 6.2, "B");
  const sox = gameLine("Sox -2", "Alt Spread", 130, 7.1, "A");
  const prop: ParsedPick = {
    game: GAME,
    market: "Player Prop",
    pick: "Over 1.5 Hits",
    odds: -120,
    isProp: true,
    player: "Test Player",
    finalAiScore: {
      composite: 5,
      grade: "B",
      confidencePct: 55,
      edgePct: 2,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 5, grade: "B", confidencePct: 55, edgePct: 2 },
    },
  };

  const { picks, dropped } = dedupeToOneGameLinePerMatchup([angels, sox, prop]);
  assert.equal(dropped, 1);
  assert.equal(picks.filter((p) => !p.isProp && p.game === GAME).length, 1);
  assert.equal(picks.find((p) => !p.isProp)?.pick, "Sox -2");
  assert.equal(picks.filter((p) => p.isProp).length, 1);
});

test("dedupeToOneGameLinePerMatchup keeps one spread vs alt spread on same side", () => {
  const spread = gameLine("Angels +1.5", "Spread", -110, 6.0);
  const alt = gameLine("Angels +2", "Alt Spread", -150, 6.8);
  const { picks, dropped } = dedupeToOneGameLinePerMatchup([spread, alt]);
  assert.equal(dropped, 1);
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.pick, "Angels +2");
});

test("assertProductionCoachTicketIntegrity dedupes before opposing-side check", () => {
  const angels = gameLine("Angels +1.5", "Spread", -110, 6.2, "B");
  const sox = gameLine("Sox -2", "Alt Spread", 130, 7.1, "A");
  const canonical = assertProductionCoachTicketIntegrity([angels, sox], undefined);
  assert.equal(canonical.filter((p) => !p.isProp).length, 1);
  assert.equal(canonical.find((p) => !p.isProp)?.pick, "Sox -2");
});

test("validateCoachTicket never surfaces two game-line cards for one gameId", () => {
  const angels = gameLine("Angels +1.5", "Spread", -110, 6.2, "B");
  const sox = gameLine("Sox -2", "Alt Spread", 130, 7.1, "A");
  const result = validateCoachTicket([angels, sox]);
  assert.equal(result.ok, true);
  assert.equal(result.canonicalPicks.filter((p) => !p.isProp).length, 1);
});
