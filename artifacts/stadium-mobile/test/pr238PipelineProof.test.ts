/**
 * PR #238 pipeline proof — live WNBA slate + cross-sport edge-priority regression.
 * Run:
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node --import ./test/register-hooks.mjs --test test/pr238PipelineProof.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { enrichCoachPropSimHits } from "../lib/coachPropSimFallback.ts";
import { impliedProb } from "../lib/format.ts";
import { simEdgeFromHit, simEvPct } from "../lib/gameSimQualityGates.ts";
import { attachPickScores } from "../lib/pickScoreContext.ts";
import {
  boardScanStagedLegQualifies,
  propSimEdgeStagingQualifies,
} from "../lib/pickRecommendation.ts";
import { parsedPickFromPoolEntry } from "../lib/propSelection.ts";
import type { PropPoolEntry } from "../lib/api.ts";

assert.equal(
  process.env.EXPO_PUBLIC_DOMAIN,
  "stadium-edge.onrender.com",
  "set EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com so api.ts hits production",
);

const API = "https://stadium-edge.onrender.com/api";

/** Pre-#238 behavior: book EV edge always won over MC. */
function legacyEdgePctFromPick(
  bookEvEdge: number | null | undefined,
  simHit: number | null,
  odds: number | null | undefined,
): number | null {
  if (bookEvEdge != null && Number.isFinite(bookEvEdge)) return bookEvEdge;
  if (simHit != null && odds != null) return simEdgeFromHit(simHit, odds);
  return null;
}

type PropSide = {
  player: string;
  market: string;
  marketLabel: string;
  line: number;
  side: "Over" | "Under";
  odds: number;
  bookEvEdge: number | null;
  athleteId: string | null;
  game: string;
  sport: string;
};

async function fetchWnbaSlate(): Promise<PropSide[]> {
  const oddsRes = await fetch(`${API}/sports/odds?sport=wnba`);
  assert.equal(oddsRes.ok, true);
  const oddsGames = (await oddsRes.json()) as {
    id: string;
    homeTeam: string;
    awayTeam: string;
  }[];

  const espnRes = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
  );
  const espn = (await espnRes.json()) as {
    events?: {
      competitions?: {
        competitors?: { homeAway?: string; team?: { id?: string; displayName?: string } }[];
      }[];
    }[];
  };

  const teamIds = new Map<string, { homeTeamId: string; awayTeamId: string }>();
  for (const ev of espn.events ?? []) {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team;
    const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team;
    if (!home?.id || !away?.id || !home.displayName || !away.displayName) continue;
    teamIds.set(`${away.displayName} @ ${home.displayName}`.toLowerCase(), {
      homeTeamId: home.id,
      awayTeamId: away.id,
    });
  }

  const out: PropSide[] = [];
  for (const g of oddsGames) {
    const label = `${g.awayTeam} @ ${g.homeTeam}`;
    const ids = teamIds.get(label.toLowerCase());
    const q = new URLSearchParams({
      sport: "wnba",
      eventId: g.id,
      home: g.homeTeam,
      away: g.awayTeam,
    });
    if (ids) {
      q.set("homeTeamId", ids.homeTeamId);
      q.set("awayTeamId", ids.awayTeamId);
    }
    const propsRes = await fetch(`${API}/sports/props?${q.toString()}`);
    if (!propsRes.ok) continue;
    const body = (await propsRes.json()) as {
      props?: {
        player: string;
        market: string;
        line: number;
        overPrice?: number | null;
        underPrice?: number | null;
        athleteId?: string | null;
        edge?: number | null;
        evSide?: string | null;
      }[];
    };
    for (const p of body.props ?? []) {
      if (p.overPrice != null) {
        out.push({
          player: p.player,
          market: p.market,
          marketLabel: p.market.replace(/^player_/, "").replace(/_/g, " "),
          line: p.line,
          side: "Over",
          odds: p.overPrice,
          bookEvEdge: p.evSide === "Over" ? (p.edge ?? null) : null,
          athleteId: p.athleteId ?? null,
          game: label,
          sport: "wnba",
        });
      }
      if (p.underPrice != null) {
        out.push({
          player: p.player,
          market: p.market,
          marketLabel: p.market.replace(/^player_/, "").replace(/_/g, " "),
          line: p.line,
          side: "Under",
          odds: p.underPrice,
          bookEvEdge: p.evSide === "Under" ? (p.edge ?? null) : null,
          athleteId: p.athleteId ?? null,
          game: label,
          sport: "wnba",
        });
      }
    }
  }
  return out;
}

function poolRowFrom(side: PropSide): PropPoolEntry {
  return {
    sport: side.sport,
    game: side.game,
    marketLabel: side.marketLabel,
    player: side.player,
    line: side.line,
    side: side.side,
    odds: side.odds,
    edge: side.bookEvEdge,
    marketKey: side.market,
    athleteId: side.athleteId,
  };
}

test("PR238 proof: full WNBA prop pipeline on live slate (Erica Wheeler Under 5.5 Assists)", async () => {
  const slate = await fetchWnbaSlate();
  assert.ok(slate.length > 0, "expected WNBA prop sides on live slate");

  const target =
    slate.find(
      (s) => s.player === "Erica Wheeler" && s.market === "player_assists" && s.side === "Under",
    ) ?? slate.find((s) => s.bookEvEdge != null && s.bookEvEdge < 0);

  assert.ok(target, "expected a prop with book EV edge on slate");

  const poolRow = poolRowFrom(target);
  const pick = parsedPickFromPoolEntry(poolRow);
  const batch = [pick];
  const pool = [poolRow];

  const serverHits = new Map<string, { hitProbability: number | null; nullReason?: string | null }>();
  const enriched = await enrichCoachPropSimHits(batch, pool, serverHits);

  const [scored] = attachPickScores(batch, {
    propPool: pool,
    propSimulations: enriched.hits,
    playerHistory: enriched.playerHistory,
    realOdds: [],
  });
  assert.ok(scored?.finalAiScore, "expected finalAiScore after attachPickScores");

  const simHit = scored.finalAiScore!.simHit;
  const implied = impliedProb(target.odds);
  const mcEdge = simHit != null ? simEdgeFromHit(simHit, target.odds) : null;
  const legacyEdge = legacyEdgePctFromPick(target.bookEvEdge, simHit, target.odds);
  const scoringEdge = scored.finalAiScore!.edgePct;
  const ev = simHit != null ? simEvPct(simHit, target.odds) : null;
  const qualifies = propSimEdgeStagingQualifies(scored, scored.finalAiScore);
  const boardQualifies = boardScanStagedLegQualifies(scored, scored.finalAiScore);

  const proof = {
    prop: `${target.player} ${target.side} ${target.line} (${target.marketLabel})`,
    game: target.game,
    sportsbookLine: {
      line: target.line,
      side: target.side,
      americanOdds: target.odds,
    },
    impliedProbabilityPct: Math.round(implied * 1000) / 10,
    monteCarlo: {
      hitRatePct: simHit != null ? Math.round(simHit * 1000) / 10 : null,
      edgePct: mcEdge,
      sampleSource: enriched.hits.size > 0 ? "client ESPN game-log fallback" : "none",
      nullReason: [...enriched.hits.values()][0]?.nullReason ?? null,
    },
    bookEv: {
      edgePct: target.bookEvEdge,
      usedByLegacyScoring: legacyEdge,
    },
    pr238Scoring: {
      edgeUsedPct: scoringEdge,
      edgeSource:
        simHit != null && simHit > 0 && simHit < 1 && mcEdge != null ? "monte_carlo" : "book_or_other",
      confidencePct: scored.finalAiScore!.confidencePct,
      grade: scored.finalAiScore!.grade,
      simAligned: scored.finalAiScore!.simAligned,
      evPct: ev,
    },
    gates: {
      propSimEdgeStagingQualifies: qualifies,
      boardScanStagedLegQualifies: boardQualifies,
      finalResult: boardQualifies ? "Recommended" : qualifies ? "Staging-qualified" : "Rejected",
    },
  };

  console.log("\n=== PR #238 PIPELINE PROOF (single prop) ===\n");
  console.log(JSON.stringify(proof, null, 2));

  assert.ok(simHit != null && simHit > 0 && simHit < 1, "expected gradable MC hit");
  assert.ok(mcEdge != null && mcEdge > 0, "expected positive MC edge");
  assert.ok((target.bookEvEdge ?? 0) <= 0, "book EV should be non-positive on this slate row");
  assert.equal(proof.pr238Scoring.edgeSource, "monte_carlo");
  assert.equal(scoringEdge, mcEdge);
  assert.notEqual(legacyEdge, scoringEdge, "PR238 must differ from legacy book-EV scoring");
  assert.equal(qualifies, true, "prop must pass edge gate with MC edge");
});

test("PR238 proof: WNBA slate qualification count (same board that returned 0 picks)", async () => {
  const slate = (await fetchWnbaSlate()).slice(0, 100);
  let legacyQualified = 0;
  let pr238Qualified = 0;
  const samples: string[] = [];

  for (const side of slate) {
    const poolRow = poolRowFrom(side);
    const pick = parsedPickFromPoolEntry(poolRow);
    const enriched = await enrichCoachPropSimHits([pick], [poolRow], new Map());
    const [scored] = attachPickScores([pick], {
      propPool: [poolRow],
      propSimulations: enriched.hits,
      playerHistory: enriched.playerHistory,
      realOdds: [],
    });
    if (!scored?.finalAiScore?.simHit) continue;

    const simHit = scored.finalAiScore.simHit!;
    const legacyEdge = legacyEdgePctFromPick(side.bookEvEdge, simHit, side.odds);
    if (
      simHit > 0 &&
      simHit < 1 &&
      legacyEdge != null &&
      legacyEdge > 0 &&
      simHit > impliedProb(side.odds)
    ) {
      legacyQualified += 1;
    }
    if (boardScanStagedLegQualifies(scored, scored.finalAiScore)) {
      pr238Qualified += 1;
      if (samples.length < 5) {
        samples.push(
          `${side.player} ${side.side} ${side.line} @ ${side.odds}: MC ${(simHit * 100).toFixed(1)}% edge ${scored.finalAiScore.edgePct}% grade ${scored.finalAiScore.grade}`,
        );
      }
    }
  }

  const summary = {
    slatePropSides: slate.length,
    legacyBookEvQualified: legacyQualified,
    pr238PipelineQualified: pr238Qualified,
    sampleQualified: samples,
  };
  console.log("\n=== PR #238 WNBA SLATE QUALIFICATION COUNT ===\n");
  console.log(JSON.stringify(summary, null, 2));

  assert.ok(pr238Qualified > 0, "PR238 pipeline must qualify at least one prop on live WNBA slate");
  assert.ok(
    pr238Qualified > legacyQualified,
    "PR238 must qualify more props than legacy book-EV scoring",
  );
});

type SportCase = {
  sport: string;
  player: string;
  market: string;
  marketLabel: string;
  line: number;
  side: "Over" | "Under";
  odds: number;
  bookEvEdge: number;
  simHit: number;
};

const CROSS_SPORT_CASES: SportCase[] = [
  {
    sport: "mlb",
    player: "Aaron Judge",
    market: "player_home_runs",
    marketLabel: "Home Runs",
    line: 0.5,
    side: "Over",
    odds: 180,
    bookEvEdge: -3.2,
    simHit: 0.42,
  },
  {
    sport: "wnba",
    player: "Erica Wheeler",
    market: "player_assists",
    marketLabel: "Assists",
    line: 5.5,
    side: "Under",
    odds: -111,
    bookEvEdge: -2.9,
    simHit: 0.7,
  },
  {
    sport: "nba",
    player: "LeBron James",
    market: "player_points",
    marketLabel: "Points",
    line: 24.5,
    side: "Over",
    odds: -115,
    bookEvEdge: -2.1,
    simHit: 0.58,
  },
  {
    sport: "nhl",
    player: "Connor McDavid",
    market: "player_points",
    marketLabel: "Points",
    line: 1.5,
    side: "Over",
    odds: -130,
    bookEvEdge: -1.8,
    simHit: 0.62,
  },
  {
    sport: "soccer",
    player: "Erling Haaland",
    market: "player_shots_on_goal",
    marketLabel: "Shots on Goal",
    line: 1.5,
    side: "Over",
    odds: 105,
    bookEvEdge: -2.5,
    simHit: 0.55,
  },
  {
    sport: "ufc",
    player: "Fighter A",
    market: "player_strikes",
    marketLabel: "Significant Strikes",
    line: 45.5,
    side: "Over",
    odds: -110,
    bookEvEdge: -2.0,
    simHit: 0.56,
  },
  {
    sport: "tennis",
    player: "Player A",
    market: "player_games",
    marketLabel: "Games",
    line: 22.5,
    side: "Over",
    odds: -108,
    bookEvEdge: -1.5,
    simHit: 0.54,
  },
];

for (const c of CROSS_SPORT_CASES) {
  test(`PR238 regression: ${c.sport} uses MC edge over book EV when sim is gradable`, () => {
    const poolRow: PropPoolEntry = {
      sport: c.sport,
      game: "Away @ Home",
      marketLabel: c.marketLabel,
      player: c.player,
      line: c.line,
      side: c.side,
      odds: c.odds,
      edge: c.bookEvEdge,
      marketKey: c.market,
      athleteId: "999",
    };
    const pick = parsedPickFromPoolEntry(poolRow);
    const hits = new Map([
      [`${c.player}|${c.market}|${c.line}|${c.side}`, { hitProbability: c.simHit }],
    ]);
    const [scored] = attachPickScores([pick], {
      propPool: [poolRow],
      propSimulations: hits,
      realOdds: [],
    });
    const mcEdge = simEdgeFromHit(c.simHit, c.odds)!;
    const legacyEdge = legacyEdgePctFromPick(c.bookEvEdge, c.simHit, c.odds);

    assert.ok(c.bookEvEdge < 0);
    assert.ok(mcEdge > 0);
    assert.equal(scored.finalAiScore?.edgePct, mcEdge);
    assert.notEqual(scored.finalAiScore?.edgePct, legacyEdge);
    if (c.simHit > impliedProb(c.odds)) {
      assert.equal(propSimEdgeStagingQualifies(scored, scored.finalAiScore), true);
    }
  });
}
