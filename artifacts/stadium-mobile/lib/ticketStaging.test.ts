import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStagedTicketFromScan,
  capThinStatMarketsOnTicket,
  tagTicketRoles,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function leg(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
  finalAiScore?: ParsedPick["finalAiScore"],
): BoardScoredLeg {
  const full: ParsedPick = {
    isProp: false,
    sport: "mlb",
    ...pick,
    finalAiScore: finalAiScore ?? pick.finalAiScore,
  };
  return {
    pick: full,
    evPct: 2,
    edgePct: 3,
    confidencePct: 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: "B",
    simHit: 0.55,
    composite: 7,
    rankScore,
  };
}

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
};

const altScore = {
  composite: 6,
  grade: "C+",
  confidencePct: 52,
  edgePct: 1.5,
  simHit: 0.53,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 6, grade: "C+", confidencePct: 52, edgePct: 1.5, scores: {} as never },
};

test("tagTicketRoles labels period moneylines as main — not alt", () => {
  const tagged = tagTicketRoles([
    {
      game: "Phoenix Mercury @ Minnesota Lynx",
      market: "1st Half Moneyline",
      pick: "Mercury ML",
      odds: 265,
      isProp: false,
      sport: "wnba",
    },
    {
      game: "Chicago Sky @ Dallas Wings",
      market: "1H Moneyline",
      pick: "Sky ML",
      odds: 235,
      isProp: false,
      sport: "wnba",
    },
  ]);
  assert.ok(tagged.every((p) => p.ticketRole === "main"));
});

test("buildStagedTicketFromScan builds balanced mix for 4+ leg targets", () => {
  const propMainScore = { ...mainScore };
  const scored: BoardScoredLeg[] = [
    leg({ game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 }, 100, mainScore),
    leg({ game: "C @ D", market: "Total", pick: "Over 8.5", odds: -105 }, 95, mainScore),
    leg({ game: "E @ F", market: "Alt Spread", pick: "E +2.5", odds: 110 }, 90, altScore),
    leg({ game: "G @ H", market: "Alt Spread", pick: "G -1.5", odds: 105 }, 85, altScore),
    leg(
      {
        game: "I @ J",
        market: "Points",
        pick: "Player Over 24.5 Points",
        odds: -110,
        isProp: true,
        player: "Player",
        propLine: 24.5,
        propSide: "Over",
      },
      99,
      propMainScore,
    ),
    leg(
      {
        game: "K @ L",
        market: "Rebounds",
        pick: "Star Over 10.5 Rebounds",
        odds: -105,
        isProp: true,
        player: "Star",
        propLine: 10.5,
        propSide: "Over",
      },
      98,
      propMainScore,
    ),
    leg(
      {
        game: "M @ N",
        market: "Stolen Bases",
        pick: "Runner Over 0.5 Stolen Bases",
        odds: 1000,
        isProp: true,
        propIsAlt: true,
        player: "Runner",
        propLine: 0.5,
        propSide: "Over",
      },
      80,
      altScore,
    ),
  ];
  const { picks } = buildStagedTicketFromScan(scored, 4);
  assert.equal(picks.length, 4);
  const props = picks.filter((p) => p.isProp).length;
  const gameLines = picks.filter((p) => !p.isProp).length;
  assert.ok(props >= 2, `expected at least 2 props, got ${props}`);
  assert.ok(gameLines <= 2, `expected at most 2 game lines, got ${gameLines}`);
});

test("buildStagedTicketFromScan returns honest shortfall — no reach-tier filler", () => {
  const belowBarScore = {
    composite: 5,
    grade: "C",
    confidencePct: 49,
    edgePct: 0.8,
    simHit: 0.51,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 5, grade: "C", confidencePct: 49, edgePct: 0.8, scores: {} as never },
  };
  const scored: BoardScoredLeg[] = [
    leg({ game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 }, 100, mainScore),
    leg({ game: "C @ D", market: "Total", pick: "Over 8.5", odds: -105 }, 95, belowBarScore),
    leg({ game: "E @ F", market: "Moneyline", pick: "E ML", odds: 120 }, 90, belowBarScore),
    leg({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: 130 }, 85, belowBarScore),
  ];
  const { picks, breakdown } = buildStagedTicketFromScan(scored, 4);
  assert.equal(picks.length, 1);
  assert.equal(breakdown.mainOnTicket, 1);
  assert.equal(breakdown.altOnTicket, 0);
  assert.ok(picks.every((p) => p.ticketRole === "main"));
});

test("buildStagedTicketFromScan stops at available qualifiers without filler", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 }, 100, mainScore),
    leg({ game: "C @ D", market: "Alt Spread", pick: "C +1.5", odds: 115 }, 90, altScore),
  ];
  const { picks, breakdown } = buildStagedTicketFromScan(scored, 15);
  assert.equal(picks.length, 2);
  assert.equal(breakdown.mainOnTicket, 1);
  assert.equal(breakdown.altOnTicket, 1);
  assert.equal(breakdown.mainQualified, 1);
  assert.equal(breakdown.altQualified, 1);
});

test("capThinStatMarketsOnTicket limits stolen bases on 6+ leg tickets", () => {
  const sb = (player: string, game: string) => ({
    game,
    market: "Stolen Bases",
    pick: `${player} Over 0.5 Stolen Bases`,
    odds: 300,
    isProp: true,
    player,
  });
  const picks = [
    sb("A", "G1"),
    sb("B", "G2"),
    sb("C", "G3"),
    sb("D", "G4"),
    { game: "G5", market: "Strikeouts", pick: "E Over 5.5 Strikeouts", odds: 105, isProp: true, player: "E" },
    { game: "G6", market: "Hits", pick: "F Over 1.5 Hits", odds: -110, isProp: true, player: "F" },
  ];
  const capped = capThinStatMarketsOnTicket(picks, 6);
  assert.equal(capped.filter((p) => p.market === "Stolen Bases").length, 2);
  assert.equal(capped.length, 4);
});

test("buildStagedTicketFromScan backfills after thin-market cap drops a leg", () => {
  const scored: BoardScoredLeg[] = [];
  for (let i = 0; i < 3; i++) {
    scored.push(
      leg(
        {
          game: `SB${i} @ Opp${i}`,
          market: "Stolen Bases",
          pick: `Runner${i} Over 0.5 Stolen Bases`,
          odds: 280 + i * 10,
          isProp: true,
          player: `Runner${i}`,
        },
        120 - i,
        mainScore,
      ),
    );
  }
  for (let i = 0; i < 8; i++) {
    scored.push(
      leg(
        {
          game: `P${i} @ Q${i}`,
          market: "Strikeouts",
          pick: `Pitcher${i} Over ${4 + i}.5 Strikeouts`,
          odds: 105 + i,
          isProp: true,
          player: `Pitcher${i}`,
        },
        110 - i,
        mainScore,
      ),
    );
  }
  const { picks } = buildStagedTicketFromScan(scored, 9);
  assert.equal(picks.length, 9);
  assert.equal(picks.filter((p) => p.market === "Stolen Bases").length, 2);
});

test("buildStagedTicketFromScan backfills when same-team game-line dedupe shrinks selection", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "A @ B", market: "Moneyline", pick: "A ML", odds: 120 }, 100, mainScore),
    leg({ game: "A @ B", market: "Spread", pick: "A +1.5", odds: -110 }, 99, mainScore),
  ];
  for (let i = 0; i < 10; i++) {
    scored.push(
      leg(
        { game: `M${i} @ N${i}`, market: "Total", pick: `Over ${8 + i}.5`, odds: -105 },
        95 - i,
        mainScore,
      ),
    );
  }
  const { picks } = buildStagedTicketFromScan(scored, 9);
  assert.equal(picks.length, 9);
});

test("buildStagedTicketFromScan greedy-fills alts without correlation throttle", () => {
  const scored: BoardScoredLeg[] = [
    leg({ game: "A @ B", market: "Spread", pick: "B -3.5", odds: -110 }, 100, mainScore),
    leg({ game: "C @ D", market: "Total", pick: "Over 8.5", odds: -105 }, 95, mainScore),
  ];
  for (let i = 0; i < 8; i++) {
    scored.push(
      leg(
        { game: `Alt${i} @ Game${i}`, market: "Alt Spread", pick: `Team +${i + 1}.5`, odds: 110 + i },
        90 - i,
        altScore,
      ),
    );
  }
  const { picks, breakdown } = buildStagedTicketFromScan(scored, 6);
  assert.equal(picks.length, 6);
  assert.equal(breakdown.mainOnTicket, 2);
  assert.equal(breakdown.altOnTicket, 4);
  assert.ok(picks.slice(2).every((p) => p.ticketRole === "alt"));
});

test("buildStagedTicketFromScan example: 10 main + 5 alt for 15-leg ask", () => {
  const scored: BoardScoredLeg[] = [];
  for (let i = 0; i < 10; i++) {
    scored.push(
      leg(
        { game: `M${i} @ N${i}`, market: "Spread", pick: `Team -${i + 1}.5`, odds: -110 },
        200 - i,
        mainScore,
      ),
    );
  }
  for (let i = 0; i < 4; i++) {
    scored.push(
      leg(
        { game: `A${i} @ B${i}`, market: "Alt Spread", pick: `Team +${i + 1}.5`, odds: 110 + i },
        100 - i,
        altScore,
      ),
    );
  }
  scored.push(
    leg(
      {
        game: "X @ Y",
        market: "Stolen Bases",
        pick: "Riley Over 0.5 Stolen Bases",
        odds: 1000,
        isProp: true,
        propIsAlt: true,
      },
      90,
      altScore,
    ),
  );
  const { picks, breakdown } = buildStagedTicketFromScan(scored, 15);
  assert.equal(picks.length, 15);
  assert.equal(breakdown.mainOnTicket, 10);
  assert.equal(breakdown.altOnTicket, 5);
});

test("topUpTicketFromQualifiedScored fills shortfall from AI-qualified leftovers only", () => {
  const short: ParsedPick[] = [
    leg({ game: "A @ B", market: "Moneyline", pick: "B ML", odds: -140 }, 100, mainScore).pick,
    leg({ game: "C @ D", market: "Spread", pick: "C +1.5", odds: -110 }, 95, mainScore).pick,
    leg({ game: "E @ F", market: "Total", pick: "Over 8.5", odds: -105 }, 90, mainScore).pick,
    leg({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: -120 }, 85, mainScore).pick,
  ];
  const scored: BoardScoredLeg[] = [
    ...short.map((pick, i) => ({
      pick,
      evPct: 2,
      edgePct: 3,
      confidencePct: 55,
      impliedProbPct: 50,
      lineShoppingScore: 1,
      grade: "B",
      simHit: 0.55,
      composite: 7,
      rankScore: 100 - i,
    })),
    leg({ game: "I @ J", market: "Spread", pick: "J -1.5", odds: -105 }, 80, mainScore),
    leg({ game: "K @ L", market: "Total", pick: "Under 9.5", odds: -105 }, 75, mainScore),
    leg({ game: "M @ N", market: "Moneyline", pick: "N ML", odds: -105 }, 70, mainScore),
    leg({ game: "O @ P", market: "Spread", pick: "O +2.5", odds: -105 }, 65, mainScore),
    // Ungraded / non-recommending — must not be used as filler
    leg(
      { game: "Q @ R", market: "Moneyline", pick: "Q ML", odds: 200 },
      99,
      {
        ...altScore,
        recommends: false,
        edgePct: 0.2,
        confidencePct: 40,
        simHit: 0.4,
        grade: "D",
        simAligned: false,
      },
    ),
  ];
  const topped = topUpTicketFromQualifiedScored(short, scored, 8);
  assert.equal(topped.length, 8);
  assert.ok(topped.every((p) => p.game !== "Q @ R"), "rejects ungraded filler");
  assert.ok(
    topped.some((p) => p.game === "I @ J") && topped.some((p) => p.game === "O @ P"),
    "pulls leftover AI-qualified legs",
  );
});

test("topUpTicketFromQualifiedScored is a no-op when already full or no leftovers", () => {
  const full = Array.from({ length: 6 }, (_, i) =>
    leg({ game: `A${i} @ B${i}`, market: "Moneyline", pick: `T${i}`, odds: -110 }, 90 - i, mainScore)
      .pick,
  );
  assert.equal(topUpTicketFromQualifiedScored(full, [], 6).length, 6);
  const short = full.slice(0, 4);
  const onlyUsed = short.map((pick, i) =>
    leg({ game: pick.game!, market: "Moneyline", pick: pick.pick!, odds: -110 }, 90 - i, mainScore),
  );
  assert.equal(topUpTicketFromQualifiedScored(short, onlyUsed, 8).length, 4);
});
