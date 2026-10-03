import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupePicksByMarketLadder,
  marketLadderKey,
  wouldRepeatMarketLadder,
} from "./marketLadderKey.ts";
import {
  askWantsAllNewPicks,
  clearParlayVarietyMemory,
  parlayLegKey,
  recentParlayVarietyContext,
  rememberParlayBuild,
} from "./parlayVarietyMemory.ts";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const altScore = {
  composite: 80,
  grade: "A",
  confidencePct: 76,
  edgePct: 18,
  simHit: 0.62,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: {
    composite: 80,
    grade: "A",
    confidencePct: 76,
    edgePct: 18,
    scores: {} as never,
  },
};

function scored(
  pick: {
    game: string;
    market: string;
    pick: string;
    odds: number;
    isProp?: boolean;
  },
  rankScore: number,
): BoardScoredLeg {
  const p = {
    ...pick,
    isProp: pick.isProp ?? false,
    finalAiScore: { ...altScore, composite: rankScore },
  };
  return {
    pick: p as BoardScoredLeg["pick"],
    evPct: 8,
    edgePct: 18,
    confidencePct: 76,
    impliedProbPct: 55,
    lineShoppingScore: 1,
    grade: "A",
    simHit: 0.62,
    composite: rankScore,
    rankScore,
  };
}

test("marketLadderKey collapses Colts +4.5 and +3.5 1H alt spreads", () => {
  const a = {
    game: "Indianapolis Colts @ Washington Commanders",
    market: "1H Alt Spread",
    pick: "Colts +4.5",
    odds: -428,
  };
  const b = {
    game: "Indianapolis Colts @ Washington Commanders",
    market: "1H Alt Spread",
    pick: "Colts +3.5",
    odds: -325,
  };
  assert.equal(marketLadderKey(a), marketLadderKey(b));
  assert.equal(wouldRepeatMarketLadder(b, [a]), true);
});

test("dedupePicksByMarketLadder keeps one Colts 1H alt rung (phone screenshot)", () => {
  const picks = [
    {
      game: "Indianapolis Colts @ Washington Commanders",
      market: "1H Alt Spread",
      pick: "Colts +4.5",
      odds: -428,
      isProp: false,
      finalAiScore: { ...altScore, composite: 90 },
    },
    {
      game: "Indianapolis Colts @ Washington Commanders",
      market: "1H Alt Spread",
      pick: "Colts +3.5",
      odds: -325,
      isProp: false,
      finalAiScore: { ...altScore, composite: 85 },
    },
    {
      game: "Chicago White Sox @ Cleveland Guardians",
      market: "Spread",
      pick: "Sox +1.5",
      odds: -170,
      isProp: false,
      finalAiScore: { ...altScore, composite: 70 },
    },
  ];
  const out = dedupePicksByMarketLadder(picks);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.pick, "Colts +4.5");
  assert.ok(out.some((p) => p.pick === "Sox +1.5"));
  assert.ok(!out.some((p) => p.pick === "Colts +3.5"));
});

test("askWantsAllNewPicks detects phone phrasing", () => {
  assert.equal(askWantsAllNewPicks("5 leg all new picks"), true);
  assert.equal(askWantsAllNewPicks("fresh picks please"), true);
  assert.equal(askWantsAllNewPicks("6 leg mlb"), false);
});

test("buildIndependentCoachTicket refuses same-ladder Colts rungs on one ticket", () => {
  const game = "Indianapolis Colts @ Washington Commanders";
  const pool: BoardScoredLeg[] = [
    scored({ game, market: "1H Alt Spread", pick: "Colts +4.5", odds: -428 }, 95),
    scored({ game, market: "1H Alt Spread", pick: "Colts +3.5", odds: -325 }, 92),
    scored(
      {
        game: "Chicago White Sox @ Cleveland Guardians",
        market: "Spread",
        pick: "Sox +1.5",
        odds: -170,
      },
      80,
    ),
    scored(
      {
        game: "San Diego Padres @ Milwaukee Brewers",
        market: "Spread",
        pick: "Padres +1.5",
        odds: -120,
      },
      78,
    ),
    scored(
      {
        game: "New York Yankees @ Tampa Bay Rays",
        market: "Alt Spread",
        pick: "Yankees +1.5",
        odds: -200,
      },
      88,
    ),
    scored(
      {
        game: "Los Angeles Dodgers @ Arizona Diamondbacks",
        market: "Spread",
        pick: "Dodgers -1.5",
        odds: -115,
      },
      75,
    ),
  ];
  const { picks } = buildIndependentCoachTicket(pool, 6, {
    varietySeed: "colts-ladder-ban",
  });
  const colts = picks.filter((p) => /colts/i.test(p.pick) && /1h/i.test(p.market));
  assert.ok(colts.length <= 1, `expected ≤1 Colts 1H alt, got ${colts.map((p) => p.pick).join(",")}`);
  const keys = new Set(picks.map((p) => marketLadderKey(p)));
  assert.equal(keys.size, picks.length, "every published leg must be a unique ladder");
});

test("hardAvoidRecentLegs skips Yankees/Padres from prior ticket when alternatives exist", () => {
  clearParlayVarietyMemory();
  const yankees = {
    game: "New York Yankees @ Tampa Bay Rays",
    market: "Alt Spread",
    pick: "Yankees +1.5",
    odds: -200,
    isProp: false,
  };
  const padres = {
    game: "San Diego Padres @ Milwaukee Brewers",
    market: "Spread",
    pick: "Padres +1.5",
    odds: -120,
    isProp: false,
  };
  rememberParlayBuild([yankees, padres] as never);
  const ctx = recentParlayVarietyContext();
  const pool: BoardScoredLeg[] = [
    scored(yankees, 99),
    scored(padres, 98),
    scored(
      {
        game: "Chicago White Sox @ Cleveland Guardians",
        market: "Spread",
        pick: "Sox +1.5",
        odds: -170,
      },
      80,
    ),
    scored(
      {
        game: "Los Angeles Dodgers @ Arizona Diamondbacks",
        market: "Spread",
        pick: "Dodgers -1.5",
        odds: -115,
      },
      78,
    ),
    scored(
      {
        game: "Atlanta Braves @ Philadelphia Phillies",
        market: "Spread",
        pick: "Braves -1.5",
        odds: -110,
      },
      76,
    ),
    scored(
      {
        game: "Boston Red Sox @ Toronto Blue Jays",
        market: "Alt Spread",
        pick: "Red Sox +1.5",
        odds: -140,
      },
      74,
    ),
  ];
  const { picks } = buildIndependentCoachTicket(pool, 4, {
    varietySeed: "all-new-avoid",
    ...ctx,
    hardAvoidRecentLegs: true,
  });
  const keys = picks.map((p) => parlayLegKey(p));
  // Soft assert with detail — Padres must not return when 4 fresh alts exist.
  if (keys.includes(parlayLegKey(padres)) || keys.includes(parlayLegKey(yankees))) {
    assert.fail(
      `reused recent legs: ${picks.map((p) => p.pick).join(" | ")} recent=${JSON.stringify(ctx.recentTickets)}`,
    );
  }
  assert.ok(picks.length >= 3, `expected fresh legs, got ${picks.length}`);
});
test("overused F5 +0.5 signature soft-avoids when fresher market shapes exist", () => {
  clearParlayVarietyMemory();
  // Two prior tickets both used F5 dog +0.5 — different teams, same shape.
  rememberParlayBuild([
    {
      game: "New York Yankees @ Tampa Bay Rays",
      market: "F5 Run Line",
      pick: "Yankees +0.5",
      odds: -120,
      isProp: false,
    },
  ] as never);
  rememberParlayBuild([
    {
      game: "San Diego Padres @ Milwaukee Brewers",
      market: "F5 Run Line",
      pick: "Padres +0.5",
      odds: -115,
      isProp: false,
    },
  ] as never);
  const ctx = recentParlayVarietyContext();
  const f5Sig = "game|f5:spread|plus|0.5";
  assert.equal(ctx.recentSignatureCounts.get(f5Sig), 2);

  const pool: BoardScoredLeg[] = [
    scored(
      {
        game: "Chicago White Sox @ Cleveland Guardians",
        market: "F5 Run Line",
        pick: "Sox +0.5",
        odds: -130,
      },
      99,
    ),
    scored(
      {
        game: "Los Angeles Dodgers @ Arizona Diamondbacks",
        market: "Moneyline",
        pick: "Dodgers",
        odds: -140,
      },
      88,
    ),
    scored(
      {
        game: "Atlanta Braves @ Philadelphia Phillies",
        market: "Total",
        pick: "Over 8.5",
        odds: -110,
      },
      86,
    ),
    scored(
      {
        game: "Boston Red Sox @ Toronto Blue Jays",
        market: "Spread",
        pick: "Red Sox -1.5",
        odds: -105,
      },
      84,
    ),
    scored(
      {
        game: "Houston Astros @ Seattle Mariners",
        market: "Moneyline",
        pick: "Astros",
        odds: -120,
      },
      82,
    ),
  ];
  const { picks } = buildIndependentCoachTicket(pool, 3, {
    varietySeed: "sig-variety",
    ...ctx,
  });
  // Prefer non-F5 shapes when the +0.5 F5 dog pattern is already overused.
  const f5Count = picks.filter((p) => /f5/i.test(p.market) && /\+0\.5/.test(p.pick)).length;
  assert.ok(
    f5Count === 0,
    `expected no overused F5 +0.5 when alternatives exist, got ${picks.map((p) => `${p.market}:${p.pick}`).join(" | ")}`,
  );
  assert.ok(picks.length >= 3, `expected full ticket, got ${picks.length}`);
});
