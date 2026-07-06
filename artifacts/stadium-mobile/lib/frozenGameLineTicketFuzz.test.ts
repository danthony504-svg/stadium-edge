import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCoachTicketValidation,
  validateCoachTicket,
  type CoachTicketValidationResult,
} from "./coachTicketValidation.ts";
import {
  GAME_LINE_EXCEPTIONAL_EDGE_PCT,
  GAME_LINE_MIN_SIM_PCT,
  GAME_LINE_STRONG_EV_PCT,
  explainGameLineQualification,
} from "./gameLineFrozenQual.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

const GAMES = [
  "Indiana Fever @ Las Vegas Aces",
  "Boston Red Sox @ Los Angeles Angels",
  "New York Yankees @ Tampa Bay Rays",
  "San Diego Padres @ Los Angeles Dodgers",
  "Philadelphia Phillies @ Kansas City Royals",
  "Houston Astros @ Washington Nationals",
  "New York Mets @ Atlanta Braves",
  "Chicago Cubs @ Milwaukee Brewers",
  "Seattle Mariners @ Texas Rangers",
  "Toronto Blue Jays @ Baltimore Orioles",
];

const PICKS = [
  "Fever +1.5",
  "Angels +1.5",
  "Rays +1.5",
  "Dodgers -2",
  "Royals +2.5",
  "Nationals -1.5",
  "Braves -1.5",
  "Cubs +1.5",
  "Mariners -1.5",
  "Blue Jays +2",
];

type MockPick = ParsedPick;
type GameLineProfile =
  | "normal"
  | "sub50_exceptional"
  | "sim50_best_ev"
  | "sim50_strong_ev"
  | "sim50_edge";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockFrozenGameLine(
  gameIdx: number,
  pickLabel: string,
  rng: () => number,
  profile?: GameLineProfile,
): MockPick {
  const game = GAMES[gameIdx % GAMES.length]!;
  const chosen = profile ?? pickGameLineProfile(rng);
  let simHit: number;
  let edge: number;
  let ev: number;
  let isBestEv = false;

  switch (chosen) {
    case "sub50_exceptional":
      simHit = 0.45 + rng() * 0.04;
      edge = GAME_LINE_EXCEPTIONAL_EDGE_PCT + rng() * 4;
      ev = edge + rng() * 2;
      break;
    case "sim50_best_ev":
      simHit = 0.5;
      edge = 1.5 + rng() * 1.5;
      ev = 2 + rng() * 1.5;
      isBestEv = true;
      break;
    case "sim50_strong_ev":
      simHit = 0.5;
      edge = 1.5 + rng();
      ev = GAME_LINE_STRONG_EV_PCT + rng() * 3;
      break;
    case "sim50_edge":
      simHit = 0.5;
      edge = GAME_LINE_STRONG_EV_PCT + rng() * 4;
      ev = edge + rng() * 2;
      break;
    default:
      simHit = 0.51 + rng() * 0.13;
      edge = 3 + rng() * 6;
      ev = edge + rng() * 3;
  }

  const confidence = 50 + Math.floor(rng() * 20);
  const oddsRaw = -200 + Math.floor(rng() * 380);
  const odds = oddsRaw === 0 ? -110 : oddsRaw;
  const market = rng() > 0.5 ? "Spread" : "Alt Spread";

  return {
    game,
    market,
    pick: pickLabel,
    odds,
    isProp: false,
    gameLineFrozen: true,
    finalAiScore: {
      composite: 6,
      grade: "B+",
      confidencePct: confidence,
      edgePct: edge,
      simHit,
      simAligned: simHit >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: 6,
        grade: "B+",
        confidencePct: confidence,
        edgePct: edge,
      },
    },
    gameLineFinal: {
      reason: chosen,
      finalScore: 6,
      frozenAt: 1,
      isBestEv,
      display: {
        pick: pickLabel,
        market,
        odds,
        game,
        grade: "B+",
        confidencePct: confidence,
        edgePct: edge,
        evPct: ev,
        simHit,
        simPct: Math.round(simHit * 100),
      },
      bullets: [chosen],
    },
  };
}

function pickGameLineProfile(rng: () => number): GameLineProfile {
  const roll = rng();
  if (roll < 0.12) return "sub50_exceptional";
  if (roll < 0.18) return "sim50_best_ev";
  if (roll < 0.24) return "sim50_strong_ev";
  if (roll < 0.32) return "sim50_edge";
  return "normal";
}

function mockProp(gameIdx: number, rng: () => number): MockPick {
  const game = GAMES[gameIdx % GAMES.length]!;
  const simHit = 0.52 + rng() * 0.12;
  const edge = 1 + rng() * 6;
  return {
    game,
    market: "Player Prop",
    pick: "Over 24.5 Points",
    odds: -115 + Math.floor(rng() * 80),
    isProp: true,
    player: `Player ${gameIdx}`,
    propLine: 24.5,
    propSide: "over",
    finalAiScore: {
      composite: 6.5,
      grade: "B",
      confidencePct: 55,
      edgePct: edge,
      simHit,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 6.5, grade: "B", confidencePct: 55, edgePct: edge },
    },
    scores: { scores: {}, composite: 6.5, grade: "B", confidencePct: 55, edgePct: edge },
  };
}

function randomCoachTicket(legCount: number, rng: () => number): MockPick[] {
  const picks: MockPick[] = [];
  const gameLineGames = new Set<number>();
  let guard = 0;
  while (picks.length < legCount && guard++ < legCount * 30) {
    const gi = Math.floor(rng() * GAMES.length);
    const wantGameLine = rng() > 0.35 && gameLineGames.size < GAMES.length;
    if (wantGameLine && !gameLineGames.has(gi)) {
      gameLineGames.add(gi);
      picks.push(mockFrozenGameLine(gi, PICKS[gi % PICKS.length]!, rng));
      continue;
    }
    picks.push(mockProp(gi, rng));
  }
  return picks;
}

function assertValidationResult(result: CoachTicketValidationResult, ticketIdx: number): void {
  if (!result.ok) {
    const v = result.violations[0]!;
    assert.fail(
      `ticket #${ticketIdx} failed [${v.code}] ${v.message}${v.gameId ? ` gameId=${v.gameId}` : ""}`,
    );
  }

  for (const audit of result.sub50GameLines) {
    assert.ok(
      audit.qualification.exceptional_edge,
      `ticket #${ticketIdx} sub-50% line ${audit.pick} (${audit.game}) must log exceptional_edge`,
    );
    assert.equal(audit.qualification.path, "exceptional_edge");
    assert.ok(
      audit.edgePct >= GAME_LINE_EXCEPTIONAL_EDGE_PCT,
      `ticket #${ticketIdx} sub-50% line ${audit.pick} edge ${audit.edgePct}% < ${GAME_LINE_EXCEPTIONAL_EDGE_PCT}%`,
    );
    assert.ok(
      audit.simPct < GAME_LINE_MIN_SIM_PCT,
      `ticket #${ticketIdx} audit simPct ${audit.simPct} should be < ${GAME_LINE_MIN_SIM_PCT}`,
    );
  }
}

test("10,000 AI Coach tickets: surfaces aligned, complete metadata, sub-50% audit", () => {
  const rng = mulberry32(0xc0acf00d);
  let sub50Legs = 0;
  let ticketsWithSub50 = 0;

  for (let n = 0; n < 10_000; n++) {
    const legCount = 1 + Math.floor(rng() * 15);
    const picks = randomCoachTicket(legCount, rng);
    const result = assertCoachTicketValidation(picks);
    assertValidationResult(result, n);

    if (result.sub50GameLines.length > 0) {
      ticketsWithSub50 += 1;
      sub50Legs += result.sub50GameLines.length;
    }
  }

  assert.ok(
    ticketsWithSub50 > 100,
    `expected meaningful sub-50% coverage across 10k tickets, got ${ticketsWithSub50} tickets / ${sub50Legs} legs`,
  );
});

test("validateCoachTicket rejects sub-50% game line without exceptional edge", () => {
  const bad = mockFrozenGameLine(1, "Angels +1.5", mulberry32(1), "normal");
  bad.gameLineFinal!.display!.simHit = 0.49;
  bad.gameLineFinal!.display!.simPct = 49;
  bad.gameLineFinal!.display!.edgePct = 2.1;
  bad.gameLineFinal!.display!.evPct = 2.5;
  bad.finalAiScore!.simHit = 0.49;
  bad.finalAiScore!.edgePct = 2.1;

  const result = validateCoachTicket([bad]);
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.code === "production_integrity" || v.code === "qualification_unexplained"),
  );
});

test("explainGameLineQualification documents sim-50 best-EV path", () => {
  const pick = mockFrozenGameLine(2, "Rays +1.5", mulberry32(2), "sim50_best_ev");
  const reason = explainGameLineQualification(pick);
  assert.equal(reason.path, "sim_at_50_best_ev");
  assert.equal(reason.best_ev_line, true);
  assert.equal(reason.simPct, 50);
});
