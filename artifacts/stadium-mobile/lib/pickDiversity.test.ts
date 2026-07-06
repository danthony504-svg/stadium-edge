import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  canAddPickDiversity,
  createPickDiversityState,
  addPickDiversityState,
  defaultDiversityCaps,
  pickMarketFamily,
  pickPlayerKey,
  reachSelectDiverseQualified,
  selectDiverseQualifiedParlay,
} from "./pickDiversity.ts";

function prop(player: string, market: string, game: string, score: number, team = "bos"): ParsedPick {
  return {
    game,
    market,
    pick: `${player} Over 0.5 ${market}`,
    odds: -110,
    isProp: true,
    player,
    teamAbbr: team,
    finalAiScore: {
      composite: score,
      grade: "B+",
      confidencePct: 55,
      edgePct: 3,
      simHit: 0.54,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: score, grade: "B+", confidencePct: 55, edgePct: 3 },
    },
    scores: { scores: {}, composite: score, grade: "B+", confidencePct: 55, edgePct: 3 },
  };
}

function gameLine(pick: string, market: string, game: string, score: number): ParsedPick {
  return {
    game,
    market,
    pick,
    odds: -110,
    isProp: false,
    finalAiScore: {
      composite: score,
      grade: "B+",
      confidencePct: 55,
      edgePct: 3,
      simHit: 0.52,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: score, grade: "B+", confidencePct: 55, edgePct: 3 },
    },
    scores: { scores: {}, composite: score, grade: "B+", confidencePct: 55, edgePct: 3 },
  };
}

test("canAddPickDiversity allows only one prop per player", () => {
  const state = createPickDiversityState();
  const caps = defaultDiversityCaps(8);
  const a = prop("Taylor Walls", "Stolen Bases", "Boston Red Sox @ Los Angeles Angels", 6.5);
  const b = prop("Taylor Walls", "Hits", "Boston Red Sox @ Los Angeles Angels", 6.4);
  assert.equal(canAddPickDiversity(a, state, caps), true);
  addPickDiversityState(a, state);
  assert.equal(canAddPickDiversity(b, state, caps), false);
});

test("selectDiverseQualifiedParlay limits legs from same game", () => {
  const game = "Boston Red Sox @ Los Angeles Angels";
  const candidates = [
    prop("Player A", "Hits", game, 6.8, "bos"),
    prop("Player B", "Strikeouts", game, 6.7, "bos"),
    prop("Player C", "Home Runs", game, 6.6, "bos"),
    prop("Player D", "Total Bases", "New York Yankees @ Tampa Bay Rays", 6.5, "nyy"),
    prop("Player E", "Hits", "Houston Astros @ Washington Nationals", 6.4, "hou"),
    prop("Player F", "Points", "Indiana Fever @ Las Vegas Aces", 6.3, "lv"),
  ];
  const picks = selectDiverseQualifiedParlay(candidates, 4, {
    target: 4,
    varietySeed: "test",
    caps: { ...defaultDiversityCaps(4), maxPerGame: 2 },
  });
  const perGame = new Map<string, number>();
  for (const p of picks) {
    perGame.set(p.game, (perGame.get(p.game) ?? 0) + 1);
  }
  assert.ok([...perGame.values()].every((n) => n <= 2));
});

test("reachSelectDiverseQualified rotates market families on close scores", () => {
  const game = "Boston Red Sox @ Los Angeles Angels";
  const candidates = [
    prop("A", "Stolen Bases", game, 6.0, "bos"),
    prop("B", "Hits", game, 6.0, "bos"),
    gameLine("Angels +1.5", "Spread", game, 6.0),
    gameLine("Over 8.5", "Total", game, 5.9),
    prop("C", "Strikeouts", "New York Yankees @ Tampa Bay Rays", 5.8, "nyy"),
    prop("D", "Home Runs", "Houston Astros @ Washington Nationals", 5.7, "hou"),
  ];
  const picks = reachSelectDiverseQualified(candidates, 4, {
    target: 4,
    varietySeed: "rotate-test",
    caps: defaultDiversityCaps(4),
  });
  const families = new Set(picks.map(pickMarketFamily));
  assert.ok(families.size >= 3, `expected market rotation, got ${[...families].join(", ")}`);
});

test("recent leg keys deprioritize repeat unless clearly stronger", () => {
  const game = "Boston Red Sox @ Los Angeles Angels";
  const repeat = prop("Taylor Walls", "Stolen Bases", game, 6.1, "bos");
  const fresh = prop("Juan Soto", "Home Runs", "New York Mets @ Atlanta Braves", 6.0, "nym");
  const picks = selectDiverseQualifiedParlay([repeat, fresh], 1, {
    target: 1,
    varietySeed: "recent",
    avoidLegKeys: new Set(["boston red sox los angeles angels|taylor walls|stolen bases"]),
    caps: defaultDiversityCaps(1),
  });
  assert.equal(picks[0]?.player, "Juan Soto");
});

test("clearly stronger recent pick still wins", () => {
  const game = "Boston Red Sox @ Los Angeles Angels";
  const repeat = prop("Taylor Walls", "Stolen Bases", game, 8.5, "bos");
  const fresh = prop("Juan Soto", "Home Runs", "New York Mets @ Atlanta Braves", 5.5, "nym");
  const picks = selectDiverseQualifiedParlay([repeat, fresh], 1, {
    target: 1,
    varietySeed: "strong",
    avoidLegKeys: new Set(["boston red sox los angeles angels|taylor walls|stolen bases"]),
    caps: defaultDiversityCaps(1),
  });
  assert.equal(picks[0]?.player, "Taylor Walls");
  assert.ok(
    (repeat.finalAiScore?.composite ?? 0) > (fresh.finalAiScore?.composite ?? 0) + 2,
  );
});
