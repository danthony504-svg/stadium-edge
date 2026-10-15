import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  enforceConsistentGameSides,
  resolveConflictingGameSide,
  simFavoredTeamSide,
} from "./gameSideConsistency.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import { optimizeGameLinePicksToBestFinalAi } from "./gameLineOptimizer.ts";

const GAME = "New York Mets @ Atlanta Braves";

function leg(pick: string, market = "Spread"): ParsedPick {
  return {
    game: GAME,
    market,
    pick,
    odds: 100,
    isProp: false,
    sport: "mlb",
  };
}

function scoredLeg(
  pick: string,
  opts: {
    market?: string;
    odds?: number;
    composite: number;
    edgePct: number;
    simHit: number;
    sport?: string;
    game?: string;
  },
): ParsedPick {
  return {
    game: opts.game ?? GAME,
    market: opts.market ?? "Spread",
    pick,
    odds: opts.odds ?? -110,
    isProp: false,
    sport: opts.sport ?? "mlb",
    finalAiScore: {
      composite: opts.composite,
      grade: "B+",
      confidencePct: 60,
      edgePct: opts.edgePct,
      simHit: opts.simHit,
      simAligned: opts.simHit >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: opts.composite,
        grade: "B+",
        confidencePct: 60,
        edgePct: opts.edgePct,
      },
    },
  };
}

test("simFavoredTeamSide picks away when Mets lead win prob", () => {
  const side = simFavoredTeamSide({
    sport: "mlb",
    simulations: 10_000,
    homeWinProbability: 0.46,
    awayWinProbability: 0.54,
    tieProbability: 0,
    homeProjectedScore: 4.5,
    awayProjectedScore: 4.5,
    mostLikelyWinner: "away",
    mostLikelyWinnerPct: 0.54,
    confidenceScore: 55,
  });
  assert.equal(side, "away");
});

test("enforceConsistentGameSides drops Giants -1 and Jays -2 on same game", () => {
  const game = "Toronto Blue Jays @ San Francisco Giants";
  const picks = [
    { game, market: "Alt Spread", pick: "Giants -1", odds: 161, isProp: false, sport: "mlb" },
    { game, market: "Alt Spread", pick: "Jays -2", odds: 200, isProp: false, sport: "mlb" },
  ];
  const r = enforceConsistentGameSides(picks);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
});

test("enforceConsistentGameSides drops Athletics -1 and Tigers -2 on same game", () => {
  const game = "Athletics @ Detroit Tigers";
  const picks = [
    { game, market: "Alt Spread", pick: "Athletics -1", odds: 150, isProp: false, sport: "mlb" },
    {
      game: "Oakland Athletics @ Detroit Tigers",
      market: "Alt Spread",
      pick: "Tigers -2",
      odds: 182,
      isProp: false,
      sport: "mlb",
    },
  ];
  const r = enforceConsistentGameSides(picks);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
});

test("enforceConsistentGameSides drops opposing alt spreads with mismatched game labels", () => {
  const picks = [
    leg("Orioles +1", "Alt Spread"),
    {
      ...leg("Cubs -1", "Alt Spread"),
      game: "Chicago Cubs @ Baltimore Orioles",
    },
  ];
  picks[0]!.game = "Cubs @ Orioles";
  const r = enforceConsistentGameSides(picks);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
});

test("enforceConsistentGameSides drops opposing alt spreads on same full game label", () => {
  const game = "Chicago Cubs @ Baltimore Orioles";
  const picks = [
    { ...leg("Orioles +1", "Alt Spread"), game },
    { ...leg("Cubs -1", "Alt Spread"), game },
  ];
  const r = enforceConsistentGameSides(picks);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
});

test("enforceConsistentGameSides drops opposing ML and spread on same game", () => {
  const sim = new Map([
    [
      GAME,
      {
        sport: "mlb",
        simulations: 10_000,
        homeWinProbability: 0.46,
        awayWinProbability: 0.54,
        tieProbability: 0,
        homeProjectedScore: 4.5,
        awayProjectedScore: 4.5,
        mostLikelyWinner: "away" as const,
        mostLikelyWinnerPct: 0.54,
        confidenceScore: 55,
        coverHitRates: {
          [`${GAME}|moneyline|mets ml`.toLowerCase()]: 0.54,
          [`${GAME}|spread|braves -1.5`.toLowerCase()]: 0.38,
        },
      },
    ],
  ]);
  const picks = [
    scoredLeg("Mets ML", {
      market: "Moneyline",
      composite: 7.8,
      edgePct: 3.2,
      simHit: 0.54,
    }),
    scoredLeg("Braves -1.5", {
      market: "Spread",
      composite: 6.0,
      edgePct: -1.0,
      simHit: 0.38,
    }),
  ];
  const r = enforceConsistentGameSides(picks, { simByGame: sim });
  assert.equal(r.picks.length, 1);
  assert.match(r.picks[0]!.pick, /Mets/i);
  assert.equal(r.dropped, 1);
});

test("underdog spread with higher Final AI survives vs favorite win-prob", () => {
  // Favorite (home) has higher outright win prob; underdog (away) spread is
  // better qualified on composite / edge / market cover.
  const game = "Detroit Lions @ Kansas City Chiefs";
  const favorite = scoredLeg("Chiefs -6.5", {
    game,
    sport: "nfl",
    composite: 6.8,
    edgePct: 0.4,
    simHit: 0.51,
  });
  const underdog = scoredLeg("Lions +6.5", {
    game,
    sport: "nfl",
    composite: 8.2,
    edgePct: 4.1,
    simHit: 0.58,
  });
  const sim = new Map([
    [
      game,
      {
        sport: "nfl",
        simulations: 10_000,
        homeWinProbability: 0.62,
        awayWinProbability: 0.38,
        tieProbability: 0,
        homeProjectedScore: 27,
        awayProjectedScore: 21,
        mostLikelyWinner: "home" as const,
        mostLikelyWinnerPct: 0.62,
        confidenceScore: 62,
        coverHitRates: {
          [`${game}|spread|chiefs -6.5`.toLowerCase()]: 0.51,
          [`${game}|spread|lions +6.5`.toLowerCase()]: 0.58,
        },
      },
    ],
  ]);

  assert.equal(simFavoredTeamSide(sim.get(game)!), "home");

  const resolution = resolveConflictingGameSide([favorite, underdog], game, {
    simByGame: sim,
  });
  assert.ok(resolution);
  assert.equal(resolution!.keep, "away");
  assert.match(resolution!.reason, /Final AI\/value/i);
  assert.equal(resolution!.rejections.length, 1);
  assert.match(resolution!.rejections[0]!.pick, /Chiefs/i);

  const sides = enforceConsistentGameSides([favorite, underdog], { simByGame: sim });
  assert.equal(sides.picks.length, 1);
  assert.match(sides.picks[0]!.pick, /Lions/i);
  assert.equal(sides.dropped, 1);

  // Full delivery belt must also keep the underdog.
  const delivered = finalizeCoachDeliveryPicks([favorite, underdog], { simByGame: sim });
  assert.equal(delivered.length, 1);
  assert.match(delivered[0]!.pick, /Lions/i);

  // Optimizer must not flip the underdog onto the favorite ladder when it
  // returns a pick (may empty if eval rubrics fail — never emit the favorite).
  const opt = optimizeGameLinePicksToBestFinalAi([underdog], sim as never, {
    evalLinesByGame: new Map([
      [
        game,
        [
          {
            sport: "nfl",
            game,
            market: "Spread",
            pick: "Lions +6.5",
            odds: -110,
            edge: 4.1,
            noVigFair: 0.55,
          },
          {
            sport: "nfl",
            game,
            market: "Spread",
            pick: "Chiefs -6.5",
            odds: -110,
            edge: 0.4,
            noVigFair: 0.52,
          },
        ],
      ],
    ]),
    realOdds: [],
  });
  assert.ok(opt.picks.every((p) => /Lions/i.test(p.pick)));
  assert.ok(!opt.picks.some((p) => /Chiefs/i.test(p.pick)));
});

test("NFL and NCAAF share market-value side resolution (P0 still separate)", () => {
  for (const sport of ["nfl", "ncaaf"] as const) {
    const game =
      sport === "nfl"
        ? "Buffalo Bills @ Baltimore Ravens"
        : "Michigan Wolverines @ Ohio State Buckeyes";
    const awayNick = sport === "nfl" ? "Bills" : "Michigan";
    const homeNick = sport === "nfl" ? "Ravens" : "Ohio State";
    const dog = scoredLeg(`${awayNick} +3.5`, {
      game,
      sport,
      composite: 7.9,
      edgePct: 3.5,
      simHit: 0.57,
    });
    const fav = scoredLeg(`${homeNick} -3.5`, {
      game,
      sport,
      composite: 6.4,
      edgePct: 0.2,
      simHit: 0.49,
    });
    const r = enforceConsistentGameSides([dog, fav], {
      simByGame: new Map([
        [
          game,
          {
            sport,
            simulations: 10_000,
            homeWinProbability: 0.61,
            awayWinProbability: 0.39,
            tieProbability: 0,
            homeProjectedScore: 28,
            awayProjectedScore: 22,
            mostLikelyWinner: "home" as const,
            mostLikelyWinnerPct: 0.61,
            confidenceScore: 61,
          },
        ],
      ]),
    });
    assert.equal(r.picks.length, 1, sport);
    assert.match(r.picks[0]!.pick, new RegExp(awayNick, "i"), sport);
  }
});
