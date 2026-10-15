/**
 * Focused regressions: conflict resolution must follow Final AI / value ranking,
 * never raw cover across differently priced spreads, ML, or alt lines.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  compareLegMetrics,
  enforceConsistentGameSides,
  gameSideLegMetrics,
  resolveConflictingGameSide,
} from "./gameSideConsistency.ts";

function scored(
  pick: string,
  opts: {
    market?: string;
    odds: number;
    composite: number;
    edgePct: number;
    simHit: number;
    game?: string;
    sport?: string;
    recommends?: boolean;
  },
): ParsedPick {
  const game = opts.game ?? "Detroit Lions @ Kansas City Chiefs";
  return {
    game,
    market: opts.market ?? "Spread",
    pick,
    odds: opts.odds,
    isProp: false,
    sport: opts.sport ?? "nfl",
    finalAiScore: {
      composite: opts.composite,
      grade: "B+",
      confidencePct: Math.round(opts.simHit * 100),
      edgePct: opts.edgePct,
      simHit: opts.simHit,
      simAligned: opts.simHit >= 0.52,
      highRiskValuePlay: false,
      recommends: opts.recommends ?? (opts.simHit >= 0.52 && opts.edgePct > 0),
      factors: [],
      rubric: {
        scores: {},
        composite: opts.composite,
        grade: "B+",
        confidencePct: Math.round(opts.simHit * 100),
        edgePct: opts.edgePct,
      },
    },
  };
}

test("regression: higher-cover pick with lower edge/EV loses to better value", () => {
  // Favorite ML covers more often but is heavily juiced → worse edge/EV.
  // Underdog +3.5 has lower raw cover but higher Final AI / edge.
  const game = "Away Dogs @ Home Chalk";
  const highCoverLowEdge = scored("Home Chalk ML", {
    game,
    market: "Moneyline",
    odds: -280,
    composite: 5.8,
    edgePct: -2.5,
    simHit: 0.72, // high raw cover
  });
  const lowerCoverHigherValue = scored("Away Dogs +3.5", {
    game,
    market: "Spread",
    odds: -105,
    composite: 7.6,
    edgePct: 4.2,
    simHit: 0.56, // lower cover, better price/value
  });

  const a = gameSideLegMetrics(highCoverLowEdge, null);
  const b = gameSideLegMetrics(lowerCoverHigherValue, null);
  assert.ok(a.marketSimHit > b.marketSimHit, "cover favors chalk ML");
  assert.ok(compareLegMetrics(b, a) > 0, "Final AI/value must beat raw cover");

  const r = enforceConsistentGameSides([highCoverLowEdge, lowerCoverHigherValue]);
  assert.equal(r.picks.length, 1);
  assert.match(r.picks[0]!.pick, /Away Dogs \+3\.5/);
  assert.doesNotMatch(r.resolutions?.[0]?.reason ?? "", /cover \d/i);
});

test("regression: underdog spread outranks favorite ML on Final AI/value", () => {
  const game = "Road Underdogs @ Home Favorites";
  const favMl = scored("Home Favorites ML", {
    game,
    market: "Moneyline",
    odds: -190,
    composite: 6.2,
    edgePct: 0.5,
    simHit: 0.64,
  });
  const dogSpread = scored("Road Underdogs +6.5", {
    game,
    market: "Alt Spread",
    odds: -110,
    composite: 8.0,
    edgePct: 3.8,
    simHit: 0.57,
  });

  const resolution = resolveConflictingGameSide([favMl, dogSpread], game);
  assert.ok(resolution);
  assert.equal(resolution!.keep, "away");
  assert.match(resolution!.rejections[0]!.pick, /Home Favorites ML/);
  assert.match(resolution!.reason, /Final AI\/value/i);

  const kept = enforceConsistentGameSides([favMl, dogSpread]);
  assert.match(kept.picks[0]!.pick, /Road Underdogs \+6\.5/);
});

test("regression: favorite legitimately offers better value and wins", () => {
  const game = "Weak Visitors @ Strong Hosts";
  const dog = scored("Weak Visitors +7", {
    game,
    market: "Spread",
    odds: -110,
    composite: 5.4,
    edgePct: -1.2,
    simHit: 0.5,
  });
  const fav = scored("Strong Hosts -3.5", {
    game,
    market: "Alt Spread",
    odds: -105,
    composite: 7.4,
    edgePct: 2.8,
    simHit: 0.55,
  });

  const r = enforceConsistentGameSides([dog, fav]);
  assert.equal(r.picks.length, 1);
  assert.match(r.picks[0]!.pick, /Strong Hosts -3\.5/);
  assert.ok(r.resolutions?.[0]?.rejections.some((x) => /Weak Visitors/.test(x.pick)));
});

test("compareLegMetrics never uses raw cover when composite and edge differ", () => {
  const lowCoverHighValue = {
    composite: 8,
    edgePct: 5,
    evPct: 4,
    simAligned: true,
    marketSimHit: 0.53,
    qualified: true,
  };
  const highCoverLowValue = {
    composite: 6,
    edgePct: 0.5,
    evPct: 0.2,
    simAligned: true,
    marketSimHit: 0.78,
    qualified: true,
  };
  assert.ok(compareLegMetrics(lowCoverHighValue, highCoverLowValue) > 0);
});

test("NFL/NCAAF share Final AI ranking; P0 decision stays outside resolver", () => {
  for (const sport of ["nfl", "ncaaf"] as const) {
    const game = sport === "nfl" ? "A @ B" : "College A @ College B";
    const dog = scored("A +3", {
      game,
      sport,
      odds: -110,
      composite: 7.8,
      edgePct: 3.0,
      simHit: 0.56,
    });
    const fav = scored("B -3", {
      game,
      sport,
      odds: -110,
      composite: 6.1,
      edgePct: 0.4,
      simHit: 0.53,
    });
    const r = enforceConsistentGameSides([dog, fav]);
    assert.match(r.picks[0]!.pick, /^A \+3$/, sport);
  }
});
