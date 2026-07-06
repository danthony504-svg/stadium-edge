import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCoachTicketValidation,
  validateCoachTicket,
} from "./coachTicketValidation.ts";
import {
  buildCoachTicketDisplayNote,
  buildFrozenGameLineSummaryNote,
} from "./frozenGameLineConsistency.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function mockFrozen(
  overrides?: Partial<NonNullable<ParsedPick["gameLineFinal"]>["display"]> & {
    isBestEv?: boolean;
  },
): ParsedPick {
  const { isBestEv, ...displayOverrides } = overrides ?? {};
  const display = {
    pick: "Rays +1.5",
    market: "Spread",
    odds: -110,
    game: "New York Yankees @ Tampa Bay Rays",
    grade: "B+",
    confidencePct: 55,
    edgePct: 5.2,
    evPct: 6.1,
    simHit: 0.49,
    simPct: 49,
    ...displayOverrides,
  };
  return {
    game: display.game,
    market: display.market,
    pick: display.pick,
    odds: display.odds,
    isProp: false,
    gameLineFrozen: true,
    finalAiScore: {
      composite: 6,
      grade: display.grade,
      confidencePct: display.confidencePct,
      edgePct: display.edgePct,
      simHit: display.simHit,
      simAligned: false,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: 6,
        grade: display.grade,
        confidencePct: display.confidencePct,
        edgePct: display.edgePct,
      },
    },
    gameLineFinal: {
      reason: "test",
      finalScore: 6,
      frozenAt: 1,
      isBestEv: isBestEv ?? false,
      display,
      bullets: ["test"],
    },
  };
}

test("assertCoachTicketValidation passes sub-50% line with exceptional edge audit", () => {
  const pick = mockFrozen({ simHit: 0.49, simPct: 49, edgePct: 5.1, evPct: 6 });
  const result = assertCoachTicketValidation([pick]);
  assert.equal(result.sub50GameLines.length, 1);
  assert.equal(result.sub50GameLines[0]!.qualification.exceptional_edge, true);
  assert.match(result.summary, /Edge: \+5\.1%/);
  assert.match(result.ticketNote, /Final AI: B\+/);
});

test("validateCoachTicket flags summary/card mismatch", () => {
  const pick = mockFrozen({ pick: "Rays +1.5" });
  const badSummary =
    "• **Yankees -1.5** (Spread) · -110 · New York Yankees @ Tampa Bay Rays\nFinal AI: B+ · Confidence: 55 · Edge: +5.2% · Sim: 49%";
  const result = validateCoachTicket([pick], { gameLineSummary: badSummary });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "production_integrity" || v.code === "summary_card_alignment"));
});

test("validateCoachTicket ensures ticket note has no placeholder dashes", () => {
  const pick = mockFrozen();
  const note = buildCoachTicketDisplayNote([pick], "_Diversity note._");
  const result = validateCoachTicket([pick], { contextNote: "_Diversity note._" });
  assert.equal(result.ok, true);
  assert.equal(result.ticketNote, note);
  assert.doesNotMatch(result.summary, /edge\s*—/);
});

test("validateCoachTicket checks summary rebuild matches cards", () => {
  const picks = [mockFrozen(), mockFrozen({
    pick: "Angels +1.5",
    game: "Boston Red Sox @ Los Angeles Angels",
    market: "Alt Spread",
    odds: 115,
    simHit: 0.54,
    simPct: 54,
    edgePct: 3.5,
    evPct: 4.2,
  })];
  picks[1]!.game = picks[1]!.gameLineFinal!.display!.game;
  picks[1]!.market = "Alt Spread";
  picks[1]!.pick = "Angels +1.5";
  picks[1]!.odds = 115;

  const result = assertCoachTicketValidation(picks);
  assert.equal(result.canonicalPicks.length, 2);
  assert.equal(
    result.summary.trim(),
    buildFrozenGameLineSummaryNote(picks).trim(),
  );
});
