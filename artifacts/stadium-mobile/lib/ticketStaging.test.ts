import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStagedTicketFromScan,
  capThinStatMarketsOnTicket,
  collapseSameTeamGameLineSides,
  tagTicketRoles,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import { fillReservedPropSlots } from "./boardScanPropDelivery.ts";
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

test("collapseSameTeamGameLineSides keeps one Browns side across FG + Q2", () => {
  const g = "Pittsburgh Steelers @ Cleveland Browns";
  const out = collapseSameTeamGameLineSides([
    {
      game: g,
      market: "Spread",
      pick: "Browns +1.5",
      odds: 101,
      isProp: false,
      sport: "nfl",
      finalAiScore: mainScore,
    },
    {
      game: g,
      market: "Q2 Spread",
      pick: "Browns +1.5",
      odds: -130,
      isProp: false,
      sport: "nfl",
      finalAiScore: { ...mainScore, composite: 9 },
    },
    {
      game: "A @ B",
      market: "Moneyline",
      pick: "B ML",
      odds: -120,
      isProp: false,
      sport: "nfl",
      finalAiScore: mainScore,
    },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out.filter((p) => /browns/i.test(p.pick)).length, 1);
  assert.match(out.find((p) => /browns/i.test(p.pick))!.market, /Q2/i);
});

test("gameLinesOnly top-up collapses FG + Q2 same-team spreads", () => {
  // Phone: Browns +1.5 SPREAD and Browns +1.5 Q2 SPREAD on team-props ticket.
  const g = "Pittsburgh Steelers @ Cleveland Browns";
  const short = [
    leg({ game: g, market: "Spread", pick: "Browns +1.5", odds: 101 }, 100, mainScore).pick,
    leg({ game: "A @ B", market: "Moneyline", pick: "B ML", odds: -120 }, 90, mainScore).pick,
    leg({ game: "C @ D", market: "Total", pick: "Under 45.5", odds: -110 }, 85, mainScore).pick,
  ];
  const scored: BoardScoredLeg[] = [
    // Same fingerprints as short — not false leftovers.
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
    // Same-team period stack must be skipped when collapsing.
    leg({ game: g, market: "Q2 Spread", pick: "Browns +1.5", odds: -130 }, 99, {
      ...mainScore,
      recommends: true,
    }),
    leg({ game: "E @ F", market: "Spread", pick: "E +3.5", odds: -105 }, 80, mainScore),
    leg({ game: "G @ H", market: "Moneyline", pick: "G ML", odds: -105 }, 75, mainScore),
    leg({ game: "I @ J", market: "Spread", pick: "I +1.5", odds: -105 }, 70, mainScore),
  ];
  // Force Q2 into leftover by marking it recommended via score on the pick.
  scored[3]!.pick = {
    ...scored[3]!.pick,
    finalAiScore: { ...mainScore, recommends: true },
  };
  const topped = topUpTicketFromQualifiedScored(short, scored, 5, undefined, null, {
    collapseSameTeamSides: true,
  });
  const browns = topped.filter((p) => /browns/i.test(p.pick) && /steelers/i.test(p.game ?? ""));
  assert.equal(browns.length, 1, `expected one Browns side, got ${browns.map((p) => `${p.market}:${p.pick}`)}`);
  assert.ok(
    topped.some((p) => p.game === "E @ F" || p.game === "G @ H" || p.game === "I @ J"),
    `expected a new-team fill, got ${topped.map((p) => p.game).join(",")}`,
  );
});

test("college team-market top-up keeps FG + Q2 + team total toward N", () => {
  // Phone: "7 leg college" — FanDuel posts FG/Q2 spreads + team totals; do not
  // collapse same-team period stacks the way NHL team props do.
  const g1 = "Ohio State Buckeyes @ Iowa Hawkeyes";
  const g2 = "Syracuse Orange @ UConn Huskies";
  const g3 = "Duke Blue Devils @ North Carolina Tar Heels";
  const short = [
    leg(
      { game: g1, market: "Spread", pick: "Iowa Hawkeyes +14.5", odds: -110, sport: "ncaaf" },
      100,
      mainScore,
    ).pick,
    leg(
      { game: g2, market: "Spread", pick: "UConn Huskies +7", odds: -115, sport: "ncaaf" },
      95,
      mainScore,
    ).pick,
    leg(
      { game: g3, market: "Spread", pick: "Duke Blue Devils +3.5", odds: -110, sport: "ncaaf" },
      90,
      mainScore,
    ).pick,
  ];
  const scored: BoardScoredLeg[] = [
    ...short.map((pick, i) =>
      leg(
        {
          game: pick.game!,
          market: pick.market!,
          pick: pick.pick!,
          odds: pick.odds!,
          sport: "ncaaf",
        },
        100 - i,
        mainScore,
      ),
    ),
    leg(
      { game: g1, market: "Q2 Spread", pick: "Iowa Hawkeyes +7.5", odds: -110, sport: "ncaaf" },
      88,
      mainScore,
    ),
    leg(
      {
        game: g1,
        market: "Team Total",
        pick: "Iowa Hawkeyes Under 17.5",
        odds: -115,
        sport: "ncaaf",
      },
      86,
      mainScore,
    ),
    leg(
      { game: g2, market: "Q2 Spread", pick: "UConn Huskies +3.5", odds: -110, sport: "ncaaf" },
      84,
      mainScore,
    ),
    leg(
      {
        game: g2,
        market: "Team Total",
        pick: "UConn Huskies Over 24.5",
        odds: -110,
        sport: "ncaaf",
      },
      82,
      mainScore,
    ),
  ];
  const topped = topUpTicketFromQualifiedScored(short, scored, 7, undefined, 4, {
    collapseSameTeamSides: false,
    collegeTeamMarketStacks: true,
  });
  assert.equal(topped.length, 7, `expected 7 college team-market legs, got ${topped.length}`);
  const iowa = topped.filter((p) => /iowa/i.test(p.pick ?? "") && /ohio state/i.test(p.game ?? ""));
  assert.ok(
    iowa.length >= 2,
    `expected Iowa FG+period/team stacks, got ${iowa.map((p) => `${p.market}:${p.pick}`)}`,
  );
  assert.ok(
    topped.some((p) => /q2/i.test(p.market ?? "")),
    "expected a Q2 period stack on the college ticket",
  );
});

test("topUpTicketFromQualifiedScored respects max 2 legs per game on 10-leg asks", () => {
  const g1 = "Los Angeles Chargers @ Buffalo Bills";
  const g2 = "Carolina Panthers @ Cleveland Browns";
  const short = [
    leg({ game: g1, market: "Q1 Spread", pick: "Chargers +3", odds: -105 }, 100, mainScore).pick,
    leg({ game: g1, market: "1H Spread", pick: "Chargers +4.5", odds: -105 }, 95, mainScore).pick,
    leg({ game: g2, market: "Spread", pick: "Panthers +2.5", odds: -105 }, 90, mainScore).pick,
    leg({ game: g2, market: "Total", pick: "Over 42.5", odds: -105 }, 85, mainScore).pick,
  ];
  const scored: BoardScoredLeg[] = [
    ...short.map((pick, i) => leg({ game: pick.game!, market: pick.market!, pick: pick.pick!, odds: -105 }, 100 - i, mainScore)),
    leg({ game: g1, market: "Q2 Spread", pick: "Chargers +3.5", odds: -105 }, 99, mainScore),
    leg({ game: g1, market: "2H Spread", pick: "Chargers +3.5", odds: -105 }, 98, mainScore),
    leg({ game: g2, market: "Q4 Spread", pick: "Panthers +0.5", odds: -105 }, 97, mainScore),
    ...Array.from({ length: 8 }, (_, i) =>
      leg({ game: `Away${i} @ Home${i}`, market: "Spread", pick: `Away${i} +3.5`, odds: -105 }, 80 - i, mainScore),
    ),
  ];
  const topped = topUpTicketFromQualifiedScored(short, scored, 10);
  assert.equal(topped.length, 10);
  const byGame = new Map<string, number>();
  for (const p of topped) byGame.set(p.game!, (byGame.get(p.game!) ?? 0) + 1);
  assert.ok((byGame.get(g1) ?? 0) <= 2, `g1 stacked ${byGame.get(g1)}`);
  assert.ok((byGame.get(g2) ?? 0) <= 2, `g2 stacked ${byGame.get(g2)}`);
  assert.ok(byGame.size >= 5, `expected ≥5 games, got ${byGame.size}`);
});

test("topUp relaxes per-game game-line cap on thin 2-game slate after props seats", () => {
  // Phone: Chargers@Bills + Panthers@Browns only — 4 game lines stuck under max-2,
  // with more period/alt mains already cleared. Props fill first; then relax.
  const g1 = "Los Angeles Chargers @ Buffalo Bills";
  const g2 = "Carolina Panthers @ Cleveland Browns";
  const short = [
    leg({ game: g1, market: "Spread", pick: "Chargers +7.5", odds: -110 }, 100, mainScore).pick,
    leg({ game: g1, market: "Total", pick: "Over 50", odds: -107 }, 98, mainScore).pick,
    leg({ game: g2, market: "Total", pick: "Over 42.5", odds: -106 }, 99, mainScore).pick,
    leg({ game: g2, market: "Alt Spread", pick: "Panthers +2.5", odds: -167 }, 85, mainScore).pick,
  ];
  const propPool: BoardScoredLeg[] = [
    leg(
      {
        game: g1,
        market: "player_rush_yds",
        pick: "Over 65.5",
        odds: -110,
        isProp: true,
        player: "J.K. Dobbins",
      },
      92,
      mainScore,
    ),
    leg(
      {
        game: g2,
        market: "player_pass_yds",
        pick: "Over 220.5",
        odds: -110,
        isProp: true,
        player: "Bryce Young",
      },
      90,
      mainScore,
    ),
  ];
  const periodAlts: BoardScoredLeg[] = [
    leg({ game: g1, market: "1H Spread", pick: "Chargers +4.5", odds: -110 }, 88, mainScore),
    leg({ game: g1, market: "Q1 Spread", pick: "Chargers +3", odds: -120 }, 86, mainScore),
    leg({ game: g1, market: "Moneyline", pick: "Chargers", odds: 220 }, 84, mainScore),
    leg({ game: g1, market: "Alt Spread", pick: "Chargers +13.5", odds: -227 }, 82, mainScore),
    leg({ game: g2, market: "1H Total", pick: "Over 20.5", odds: -110 }, 87, mainScore),
    leg({ game: g2, market: "Q2 Spread", pick: "Panthers +1.5", odds: -115 }, 83, mainScore),
    leg({ game: g2, market: "Moneyline", pick: "Panthers", odds: 150 }, 81, mainScore),
    leg({ game: g2, market: "1H Spread", pick: "Panthers +1.5", odds: -110 }, 79, mainScore),
  ];
  const scored: BoardScoredLeg[] = [
    ...short.map((pick, i) =>
      leg(
        {
          game: pick.game!,
          market: pick.market!,
          pick: pick.pick!,
          odds: pick.odds ?? -110,
          isProp: pick.isProp,
        },
        100 - i,
        mainScore,
      ),
    ),
    ...propPool,
    ...periodAlts,
  ];
  // Props first (mirrors buildScanResult order), then top-up with relax.
  const withProps = fillReservedPropSlots(short, scored, 10);
  assert.ok(withProps.filter((p) => p.isProp).length >= 2, "props get seats before relax");
  const topped = topUpTicketFromQualifiedScored(withProps, scored, 10);
  assert.ok(topped.length >= 8, `expected thin-slate fill ≥8, got ${topped.length}`);
  assert.ok(topped.filter((p) => p.isProp).length >= 2, "props retained after game-line relax");
  assert.ok(
    topped.some((p) => /1H|Q1|Q2|Alt|Moneyline/i.test(p.market)),
    "period/alt/ML rungs fill remaining seats",
  );
});

test("topUp relaxes game-line cap when no props qualify on 2-game board", () => {
  const g1 = "Los Angeles Chargers @ Buffalo Bills";
  const g2 = "Carolina Panthers @ Cleveland Browns";
  const short = [
    leg({ game: g1, market: "Spread", pick: "Chargers +7.5", odds: -110 }, 100, mainScore).pick,
    leg({ game: g1, market: "Total", pick: "Over 50", odds: -107 }, 98, mainScore).pick,
    leg({ game: g2, market: "Total", pick: "Over 42.5", odds: -106 }, 99, mainScore).pick,
    leg({ game: g2, market: "Spread", pick: "Panthers +3.5", odds: -110 }, 97, mainScore).pick,
  ];
  const scored: BoardScoredLeg[] = [
    ...short.map((pick, i) =>
      leg({ game: pick.game!, market: pick.market!, pick: pick.pick!, odds: -110 }, 100 - i, mainScore),
    ),
    leg({ game: g1, market: "1H Spread", pick: "Chargers +4.5", odds: -110 }, 88, mainScore),
    leg({ game: g1, market: "Q1 Spread", pick: "Chargers +3", odds: -120 }, 86, mainScore),
    leg({ game: g1, market: "Moneyline", pick: "Chargers", odds: 220 }, 84, mainScore),
    leg({ game: g1, market: "Alt Spread", pick: "Chargers +13.5", odds: -227 }, 82, mainScore),
    leg({ game: g2, market: "1H Total", pick: "Over 20.5", odds: -110 }, 87, mainScore),
    leg({ game: g2, market: "Q2 Spread", pick: "Panthers +1.5", odds: -115 }, 83, mainScore),
    leg({ game: g2, market: "Moneyline", pick: "Panthers", odds: 150 }, 81, mainScore),
    leg({ game: g2, market: "1H Spread", pick: "Panthers +1.5", odds: -110 }, 79, mainScore),
  ];
  const topped = topUpTicketFromQualifiedScored(short, scored, 10);
  assert.ok(topped.length >= 8, `expected ≥8 from period/alt relax, got ${topped.length}`);
  assert.equal(topped.filter((p) => p.isProp).length, 0);
});

test("top-up after excluded-matchup filter never reintroduces Florida @ Anaheim", async () => {
  const { excludedTeamScopesFromText, filterPicksExcludingTeams } = await import(
    "./coachAskTeamScope.ts"
  );
  const excluded = excludedTeamScopesFromText("6 leg NHL not the ducks");
  const ducks = "Florida Panthers @ Anaheim Ducks";
  const ok1 = "Calgary Flames @ Seattle Kraken";
  const ok2 = "Vegas Golden Knights @ Vancouver Canucks";
  const short: ParsedPick[] = [
    leg({ game: ok1, market: "Moneyline", pick: "Kraken", odds: 120, sport: "nhl" }, 100, mainScore).pick,
    leg({ game: ok1, market: "Total", pick: "Over 5.5", odds: -110, sport: "nhl" }, 95, mainScore).pick,
    leg({ game: ok2, market: "Moneyline", pick: "Canucks", odds: -105, sport: "nhl" }, 90, mainScore).pick,
    leg({ game: ok2, market: "Puck Line", pick: "Canucks +1.5", odds: -115, sport: "nhl" }, 85, mainScore).pick,
  ];
  const scoredRaw: BoardScoredLeg[] = [
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
    // Would fill seats 5–6 if exclusion were bypassed
    leg(
      { game: ducks, market: "POINTS", pick: "Luneau Over 0.5", odds: 220, sport: "nhl", isProp: true },
      99,
      mainScore,
    ),
    leg(
      { game: ducks, market: "ALT TOTAL", pick: "Over 6.5", odds: -105, sport: "nhl" },
      98,
      mainScore,
    ),
    leg(
      { game: "Ottawa Senators @ Boston Bruins", market: "Moneyline", pick: "Bruins", odds: -130, sport: "nhl" },
      70,
      mainScore,
    ),
    leg(
      { game: "Winnipeg Jets @ Pittsburgh Penguins", market: "Total", pick: "Under 6.5", odds: -110, sport: "nhl" },
      65,
      mainScore,
    ),
  ];
  // Mirror buildScanResult exclusion belt before top-up.
  const scored = scoredRaw.filter(
    (leg) => filterPicksExcludingTeams([leg.pick], excluded).length > 0,
  );
  const topped = topUpTicketFromQualifiedScored(short, scored, 6);
  // May land 5–6 depending on mix caps; never pad with the excluded Ducks game.
  assert.ok(topped.length >= 5 && topped.length <= 6, `got ${topped.length}`);
  assert.ok(
    topped.every((p) => !/ducks|anaheim/i.test(String(p.game))),
    "excluded Ducks matchup must not re-enter via ALT/top-up",
  );
  assert.equal(
    scoredRaw.length - scored.length,
    2,
    "both Ducks leftovers must be stripped before top-up",
  );
  assert.ok(excluded.length >= 1);
});
