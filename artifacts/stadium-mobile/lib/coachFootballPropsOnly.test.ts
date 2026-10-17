import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  FOOTBALL_PROPS_ONLY_BATCH,
  footballPropsOnlyFamilyCounts,
  footballPropsOnlyMaxCandidates,
  isFootballPropsOnlyCandidate,
  selectFootballPropsOnlyFromPicks,
  shouldBuildFootballPropsOnlyTicket,
  stageFootballPropsOnlyLegs,
  propsOnlyPerGameCeiling,
} from "./coachFootballPropsOnly.ts";
import {
  collapsePropsOnlyToBestEvSides,
  gradeFootballPropFromHistory,
  gradeFootballPropsOnlyFromHistory,
  mergePropsOnlyHistoryGames,
  mergePropsOnlySeasonLogs,
  normalizeHistorySport,
  normalizePropsOnlyPick,
  propsOnlyEffectiveLine,
  propsOnlyLegClearsOdds,
  propsOnlyPickHasGrade,
  propsOnlyPriorSeasonYear,
  propsOnlySimLookupKey,
  type PropsOnlyHit,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  EXACT_MARKET_10K_MIN_SIMULATIONS,
  exactMarket10kProvenance,
  withExactMarket10kProvenance,
} from "./coachPropProbabilityProvenance.ts";
import { clipPropSimHitForGrade, pickHasSimGrade } from "./simMarketSupport.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import {
  keepOrSwapDefenseAwareSide,
  shouldPreferDefenseAltPick,
} from "./footballRushDefense.ts";

function pick(
  market: string,
  player: string,
  line: number | null,
  opts?: {
    athleteId?: string | null;
    side?: "Over" | "Under";
    odds?: number;
  },
): ParsedPick {
  const side = opts?.side ?? "Over";
  return {
    game: "Away @ Home",
    market,
    propMarketKey: market,
    pick: line != null ? `${player} ${side} ${line}` : `${player} Anytime TD`,
    odds: opts?.odds ?? -110,
    isProp: true,
    player,
    propLine: line,
    propSide: side,
    sport: "nfl",
    athleteId: opts?.athleteId === null ? null : (opts?.athleteId ?? `ath-${player}`),
    eventId: `evt-${player}`,
  } as ParsedPick;
}

function assertUnapprovedHistoricalSeat(graded: PropsOnlyHit): void {
  assert.equal(graded.hitProbability, null);
  assert.equal(graded.probabilityProvenance?.source, "insufficient_evidence");
  assert.equal(graded.probabilityProvenance?.nullReason, "unapproved_historical_model");
}

function exact10kPropsOnlyHit(
  p: ParsedPick,
  hitProbability: number,
  hitReliability = 0.7,
): PropsOnlyHit {
  const probabilityProvenance = exactMarket10kProvenance({
    hitProbability,
    simulations: EXACT_MARKET_10K_MIN_SIMULATIONS,
    sport: p.sport,
    marketKey: p.propMarketKey ?? p.market,
    hitReliability,
    athleteId: p.athleteId ?? "ath-props",
    eventId: p.eventId ?? "evt-props",
    side: p.propSide ?? "Over",
    line: p.propLine ?? 0.5,
  });
  return {
    hitProbability,
    nullReason: null,
    hitReliability,
    probabilityProvenance,
  };
}

function setExact10kHitOnMap(
  hits: Map<string, PropsOnlyHit>,
  p: ParsedPick,
  hitProbability: number,
  hitReliability = 0.7,
): void {
  const norm = normalizePropsOnlyPick(p);
  const key = propsOnlySimLookupKey(norm, undefined);
  if (!key) return;
  hits.set(key, exact10kPropsOnlyHit(norm, hitProbability, hitReliability));
}

function stampPropsOnlyScoredLeg(leg: BoardScoredLeg, hit: number): BoardScoredLeg {
  const athleteId = leg.pick.athleteId ?? "ath-props";
  const eventId = leg.pick.eventId ?? "evt-props";
  const propSide = (leg.pick.propSide === "Under" ? "Under" : "Over") as "Over" | "Under";
  const propLine = leg.pick.propLine ?? 0.5;
  const pick = withExactMarket10kProvenance({
    ...leg.pick,
    isProp: true,
    propsOnlyTicket: true,
    athleteId,
    eventId,
    propSide,
    propLine,
    simHit: hit,
    finalAiScore: {
      grade: leg.grade ?? "B",
      confidencePct: leg.confidencePct ?? 60,
      edgePct: leg.edgePct ?? 5,
      simHit: hit,
      simAligned: true,
      recommends: true,
      composite: leg.composite ?? 7,
      highRiskValuePlay: false,
      factors: [],
      propProbabilityProvenance: exactMarket10kProvenance({
        hitProbability: hit,
        simulations: EXACT_MARKET_10K_MIN_SIMULATIONS,
        sport: leg.pick.sport,
        marketKey: leg.pick.propMarketKey ?? leg.pick.market,
        athleteId,
        eventId,
        side: propSide,
        line: propLine,
      }),
    } as never,
  });
  return { ...leg, pick, simHit: hit };
}

test("props-only NFL ask uses dedicated football props-only rebuild path", () => {
  assert.equal(
    shouldBuildFootballPropsOnlyTicket({
      propsOnly: true,
      pool: Array.from({ length: 30 }, () => ({ sport: "nfl" })),
    }),
    true,
  );
  assert.equal(
    shouldBuildFootballPropsOnlyTicket({
      propsOnly: true,
      pool: Array.from({ length: 30 }, () => ({ sport: "mlb" })),
    }),
    true,
  );
});

test("phone 3-of-8: WNBA-heavy props-only still uses dedicated path (not generic board scan)", () => {
  // Afternoon board is mostly WNBA — old ≥50% football gate skipped the rebuild
  // and staged only 3 legs via confidence/holistic wipe.
  const pool = [
    ...Array.from({ length: 80 }, () => ({ sport: "wnba" })),
    ...Array.from({ length: 10 }, () => ({ sport: "nfl" })),
    ...Array.from({ length: 5 }, () => ({ sport: "mlb" })),
  ];
  assert.equal(
    shouldBuildFootballPropsOnlyTicket({ propsOnly: true, pool }),
    true,
    "props-only must never fall through to generic board scan",
  );
  assert.equal(
    shouldBuildFootballPropsOnlyTicket({ propsOnly: false, pool }),
    false,
  );
  assert.equal(
    shouldBuildFootballPropsOnlyTicket({ propsOnly: true, pool: [] }),
    false,
  );
});

test("phone PROP_ALL_NO_SIM_GRADE rebuild: athleteId required + finishable skill mix", () => {
  const ranked: ParsedPick[] = [
    ...Array.from({ length: 200 }, (_, i) =>
      pick("player_anytime_td", `TdNoId${i}`, 0.5, { athleteId: null }),
    ),
    ...Array.from({ length: 80 }, (_, i) => pick("player_anytime_td", `Td${i}`, 0.5)),
    ...Array.from({ length: 60 }, (_, i) =>
      pick("player_pass_yds", `Pass${i}`, 240.5 + (i % 5)),
    ),
    ...Array.from({ length: 40 }, (_, i) => pick("player_rush_yds", `Rush${i}`, 65.5)),
  ];
  const selected = selectFootballPropsOnlyFromPicks(ranked, 9);
  assert.ok(selected.length > 0);
  assert.ok(selected.length <= footballPropsOnlyMaxCandidates(9, 5000));
  assert.ok(selected.length < 72, "must stay well under the failed 72-wide enrich batches");
  assert.ok(selected.every((p) => !!p.athleteId), "no missing-athleteId dead ends");
  const families = footballPropsOnlyFamilyCounts(selected);
  assert.ok((families.yards ?? 0) > 0, "yards must be in the graded set");
  assert.ok((families.td ?? 0) > 0, "TD still represented");
});

test("tiny batch size lets local enrich finish (phone wipe was wide-batch timeout)", () => {
  assert.equal(FOOTBALL_PROPS_ONLY_BATCH, 8);
  const max = footballPropsOnlyMaxCandidates(9, 4713);
  assert.ok(Math.ceil(max / FOOTBALL_PROPS_ONLY_BATCH) <= 8);
});

test("binary TD: no 2% floor; shrunk mid-rates remain gradeable", () => {
  const p = {
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propLine: 0.5,
    isProp: true,
    sport: "nfl",
  };
  assert.equal(pickHasSimGrade(p, 0), false);
  // Zero evidence must stay ungradeable — no manufactured longshot EV.
  assert.equal(clipPropSimHitForGrade(p, 0), null);
  assert.equal(pickHasSimGrade(p, clipPropSimHitForGrade(p, 0)), false);
  assert.equal(pickHasSimGrade(p, clipPropSimHitForGrade(p, 1)), true);
  assert.equal(pickHasSimGrade(p, clipPropSimHitForGrade(p, 0.18)), true);
});

test("#541 empty: null-line anytime TD normalizes to 0.5 and is a candidate", () => {
  const nullTd = pick("player_anytime_td", "Kelce", null, { athleteId: "15847" });
  assert.equal(propsOnlyEffectiveLine(nullTd), 0.5);
  const norm = normalizePropsOnlyPick(nullTd);
  assert.equal(norm.propLine, 0.5);
  assert.equal(norm.propSide, "Over");
  assert.equal(isFootballPropsOnlyCandidate(nullTd), true);
  const selected = selectFootballPropsOnlyFromPicks([nullTd], 8);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].propLine, 0.5);
});

test("phone empty after #539: prefetched history grades yards + TD without network", () => {
  const pass = pick("player_pass_yds", "Mahomes", 250.5, { athleteId: "3139477" });
  const td = pick("player_anytime_td", "Kelce", 0.5, { athleteId: "15847" });
  const rush = pick("player_rush_yds", "Hunt", 55.5, { athleteId: "3043078" });

  const histories = {
    "Mahomes#3139477": {
      recent: Array.from({ length: 8 }, (_, i) => ({
        stats: { passingYards: String(260 + (i % 3) * 20) },
      })),
    },
    "Kelce#15847": {
      recent: Array.from({ length: 8 }, (_, i) => ({
        stats: {
          rushingTouchdowns: "0",
          receivingTouchdowns: i % 2 === 0 ? "1" : "0",
          passingTouchdowns: "0",
        },
      })),
    },
    "Hunt#3043078": {
      recent: Array.from({ length: 8 }, (_, i) => ({
        stats: { rushingYards: String(40 + i * 5) },
      })),
    },
  };

  const hits = gradeFootballPropsOnlyFromHistory([pass, td, rush], histories);
  assert.equal(
    propsOnlyPickHasGrade(pass, hits),
    false,
    "empty allowlist: history must not seat pass yards",
  );
  assert.equal(propsOnlyPickHasGrade(td, hits), false);
  assert.equal(propsOnlyPickHasGrade(rush, hits), false);

  const passGraded = gradeFootballPropFromHistory(pass, histories["Mahomes#3139477"]);
  const tdGraded = gradeFootballPropFromHistory(td, histories["Kelce#15847"]);
  assertUnapprovedHistoricalSeat(passGraded);
  assertUnapprovedHistoricalSeat(tdGraded);
  assert.ok((tdGraded.hitReliability ?? 0) > 0);
});

test("null-line TD grades from history after normalize (phone #541 path)", () => {
  // +150 leaves room for Bayesian shrink on a 4/8 scoring log (no 2% floor).
  const td = pick("player_anytime_td", "Kelce", null, { athleteId: "15847", odds: 150 });
  const hist = {
    recent: Array.from({ length: 8 }, (_, i) => ({
      stats: {
        rushingTouchdowns: "0",
        receivingTouchdowns: i % 2 === 0 ? "1" : "0",
        passingTouchdowns: "0",
      },
    })),
  };
  const graded = gradeFootballPropFromHistory(normalizePropsOnlyPick(td), hist);
  assertUnapprovedHistoricalSeat(graded);
  assert.ok(
    (graded.hitReliability ?? 0) > 0.5,
    "4/8 scoring games should carry mid/high reliability",
  );
  // Odds gate is separate from Option C seating — use authorized 10k hit.
  assert.equal(propsOnlyLegClearsOdds(normalizePropsOnlyPick(td), 0.55), true);
});

test("normalizeHistorySport maps Odds API keys to ESPN history ids", () => {
  assert.equal(normalizeHistorySport("americanfootball_nfl"), "nfl");
  assert.equal(normalizeHistorySport("americanfootball_ncaaf"), "ncaaf");
  assert.equal(normalizeHistorySport("NFL"), "nfl");
});

test("props-only odds gate: hit near/above implied clears; deep underdogs do not", () => {
  const p = pick("player_pass_yds", "Mahomes", 250.5);
  assert.equal(propsOnlyLegClearsOdds(p, 0.60), true);
  // -110 implied ≈ 0.5238 — 50% with 2pp slack clears (short TD sample)
  assert.equal(propsOnlyLegClearsOdds(p, 0.50), true);
  assert.equal(propsOnlyLegClearsOdds(p, 0.48), false);
  assert.equal(propsOnlyLegClearsOdds(p, null), false);
});

test("soft line + real history clears odds gate for staging", () => {
  const pass = pick("player_pass_yds", "Mahomes", 220.5, { athleteId: "3139477" });
  const histories = {
    "Mahomes#3139477": {
      recent: Array.from({ length: 8 }, () => ({
        stats: { passingYards: "275" },
      })),
    },
  };
  const hits = gradeFootballPropsOnlyFromHistory([pass], histories);
  assertUnapprovedHistoricalSeat([...hits.values()][0]!);
  const seatHit = 0.95;
  setExact10kHitOnMap(hits, pass, seatHit);
  assert.equal(propsOnlyLegClearsOdds(pass, seatHit), true);
});

test("wrong Over flips to history-backed Under (EV side rebuild)", () => {
  // Line sits above recent yards — Over fails odds gate; Under clears.
  const over = pick("player_pass_yds", "Mahomes", 275.5, {
    athleteId: "3139477",
    side: "Over",
  });
  const under = pick("player_pass_yds", "Mahomes", 275.5, {
    athleteId: "3139477",
    side: "Under",
  });
  const histories = {
    "Mahomes#3139477": {
      recent: Array.from({ length: 8 }, () => ({
        stats: { passingYards: "240" },
      })),
    },
  };
  const hits = gradeFootballPropsOnlyFromHistory([over, under], histories);
  const overSeatHit = 0.12;
  const underSeatHit = 0.88;
  setExact10kHitOnMap(hits, over, overSeatHit);
  setExact10kHitOnMap(hits, under, underSeatHit);
  assert.equal(propsOnlyLegClearsOdds(over, overSeatHit), false);
  assert.equal(propsOnlyLegClearsOdds(under, underSeatHit), true);
  const collapsed = collapsePropsOnlyToBestEvSides([over, under], hits);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].propSide, "Under");
  assert.equal(propsOnlyLegClearsOdds(collapsed[0], underSeatHit), true);
});

test("collapse promotes odds-clearing alt rung when main fails quality bar", () => {
  // Main Over 80.5 is juice-heavy vs history (~55 yds) — fails clearsOdds.
  // Softer `_alternate` Over 49.5 clears. Must stage the alt, not empty.
  const main = {
    ...pick("player_rush_yds", "Henry", 80.5, {
      athleteId: "henry-1",
      side: "Over",
      odds: -200,
    }),
    propIsAlt: false,
  };
  const alt = {
    ...pick("player_rush_yds_alternate", "Henry", 49.5, {
      athleteId: "henry-1",
      side: "Over",
      odds: -110,
    }),
    propIsAlt: true,
  };
  const histories = {
    "Henry#henry-1": {
      recent: Array.from({ length: 8 }, () => ({
        stats: { rushingYards: "55" },
      })),
    },
  };
  const hits = gradeFootballPropsOnlyFromHistory([main, alt], histories);
  const mainSeatHit = 0.28;
  const altSeatHit = 0.72;
  setExact10kHitOnMap(hits, main, mainSeatHit);
  setExact10kHitOnMap(hits, alt, altSeatHit);
  assert.equal(propsOnlyLegClearsOdds(main, mainSeatHit), false);
  assert.equal(propsOnlyLegClearsOdds(alt, altSeatHit), true);
  const collapsed = collapsePropsOnlyToBestEvSides([main, alt], hits);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].propLine, 49.5);
  assert.equal(collapsed[0].propIsAlt, true);
  assert.ok(
    propsOnlyLegClearsOdds(collapsed[0], altSeatHit),
    "alt rung that clears odds must win the ladder",
  );

  const scored: BoardScoredLeg[] = [
    stampPropsOnlyScoredLeg(
      {
        pick: { ...collapsed[0], propsOnlyTicket: true },
        evPct: 10,
        edgePct: 10,
        confidencePct: 60,
        impliedProbPct: 52,
        lineShoppingScore: null,
        grade: "B",
        simHit: altSeatHit,
        composite: 7,
        rankScore: 7,
      } as BoardScoredLeg,
      altSeatHit,
    ),
  ];
  const staged = stageFootballPropsOnlyLegs(scored, 1);
  assert.equal(staged.length, 1);
  assert.equal(staged[0].propLine, 49.5);
  assert.equal(staged[0].ticketRole, "alt");
});

test("collapse promotes softer rush TD alt when main Over 1.5 fails odds", () => {
  // "5 leg touchdown" board posts rush_tds Over 1.5 (main) + Over 0.5 (alt).
  // History hits ~0.5 TDs/g — main fails juice, alt clears.
  const main = {
    ...pick("player_rush_tds", "Barkley", 1.5, {
      athleteId: "sb-1",
      side: "Over",
      odds: 250,
    }),
    propIsAlt: false,
  };
  const alt = {
    ...pick("player_rush_tds_alternate", "Barkley", 0.5, {
      athleteId: "sb-1",
      side: "Over",
      odds: -110,
    }),
    propIsAlt: true,
  };
  const histories = {
    "Barkley#sb-1": {
      recent: Array.from({ length: 8 }, (_, g) => ({
        stats: {
          rushingTouchdowns: g % 2 === 0 ? "1" : "0",
          receivingTouchdowns: "0",
          passingTouchdowns: "0",
        },
      })),
    },
  };
  const hits = gradeFootballPropsOnlyFromHistory([main, alt], histories);
  const mainSeatHit = 0.22;
  const altSeatHit = 0.58;
  setExact10kHitOnMap(hits, main, mainSeatHit);
  setExact10kHitOnMap(hits, alt, altSeatHit);
  assert.equal(propsOnlyLegClearsOdds(main, mainSeatHit), false);
  assert.equal(propsOnlyLegClearsOdds(alt, altSeatHit), true);
  const collapsed = collapsePropsOnlyToBestEvSides([main, alt], hits);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].propLine, 0.5);
  assert.equal(collapsed[0].propIsAlt, true);
});

test("8-leg props-only stages from graded best-EV sides (no empty quality bar)", () => {
  const candidates: ParsedPick[] = [];
  const histories: Record<string, { recent: { stats: Record<string, string> }[] }> = {};

  for (let i = 0; i < 8; i++) {
    const name = `Pass${i}`;
    const id = `pass-${i}`;
    const game = `Away${i} @ Home${i}`;
    const over = {
      ...pick("player_pass_yds", name, 220.5, { athleteId: id, side: "Over" }),
      game,
    };
    const under = {
      ...pick("player_pass_yds", name, 220.5, { athleteId: id, side: "Under" }),
      game,
    };
    candidates.push(over, under);
    histories[`${name}#${id}`] = {
      recent: Array.from({ length: 8 }, () => ({
        stats: { passingYards: "260" },
      })),
    };
  }
  for (let i = 0; i < 4; i++) {
    const name = `Td${i}`;
    const id = `td-${i}`;
    const game = `TdAway${i} @ TdHome${i}`;
    candidates.push({
      ...pick("player_anytime_td", name, null, { athleteId: id, odds: 150 }),
      game,
    });
    histories[`${name}#${id}`] = {
      recent: Array.from({ length: 8 }, (_, g) => ({
        stats: {
          rushingTouchdowns: "0",
          receivingTouchdowns: g % 2 === 0 ? "1" : "0",
          passingTouchdowns: "0",
        },
      })),
    };
  }

  const hits = gradeFootballPropsOnlyFromHistory(candidates, histories);
  for (const p of candidates) {
    if (p.propMarketKey === "player_pass_yds" && p.propSide === "Over") {
      setExact10kHitOnMap(hits, p, 0.92);
    } else if (p.propMarketKey === "player_pass_yds" && p.propSide === "Under") {
      setExact10kHitOnMap(hits, p, 0.08);
    } else if (p.propMarketKey === "player_anytime_td") {
      setExact10kHitOnMap(hits, p, 0.55);
    }
  }
  const best = collapsePropsOnlyToBestEvSides(candidates, hits);
  assert.ok(best.length >= 8, `expected ≥8 best-EV sides, got ${best.length}`);

  const scored: BoardScoredLeg[] = best
    .map((p) => {
      const hit =
        hits.get(propsOnlySimLookupKey(normalizePropsOnlyPick(p), undefined) ?? "")
          ?.hitProbability ?? null;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      return stampPropsOnlyScoredLeg(
        {
          pick: p,
          evPct: ((hit ?? 0) - 0.52) * 100,
          edgePct: ((hit ?? 0) - 0.52) * 100,
          confidencePct: 60,
          impliedProbPct: 52.4,
          lineShoppingScore: null,
          grade: "B",
          simHit: hit,
          composite: 7,
          rankScore: 7 + ((hit ?? 0) - 0.52),
        } as BoardScoredLeg,
        hit ?? 0.58,
      );
    })
    .filter((x): x is BoardScoredLeg => !!x);

  assert.ok(scored.length >= 8, `expected ≥8 scored clearing odds, got ${scored.length}`);
  const staged = stageFootballPropsOnlyLegs(scored, 8);
  assert.equal(staged.length, 8, "8-leg NFL props must stage — not empty quality bar");
  assert.ok(staged.every((p) => p.propLine != null));
});

test("phone insufficient_game_log rebuild: 2-game early-season sample grades", () => {
  // 2026 week ~3: ESPN current season often has only 2–3 games. Old min=3 wiped all.
  const td = pick("player_anytime_td", "Kelce", null, { athleteId: "15847" });
  const hist = {
    recent: [
      {
        date: "2026-09-20",
        stats: {
          rushingTouchdowns: "0",
          receivingTouchdowns: "1",
          passingTouchdowns: "0",
        },
      },
      {
        date: "2026-09-13",
        stats: {
          rushingTouchdowns: "0",
          receivingTouchdowns: "0",
          passingTouchdowns: "0",
        },
      },
    ],
  };
  const graded = gradeFootballPropFromHistory(normalizePropsOnlyPick(td), hist);
  assertUnapprovedHistoricalSeat(graded);
});

test("merge prior-season logs fills thin current season (phone hist=19 graded=0)", () => {
  const current = [
    {
      date: "2026-09-20",
      opp: "Bal",
      stats: { receivingYards: "59", receivingTouchdowns: "1" },
    },
  ];
  const prior = [
    {
      date: "2025-12-15",
      opp: "Den",
      stats: { receivingYards: "80", receivingTouchdowns: "1" },
    },
    {
      date: "2025-12-08",
      opp: "Hou",
      stats: { receivingYards: "70", receivingTouchdowns: "0" },
    },
    {
      date: "2025-12-01",
      opp: "Lv",
      stats: { receivingYards: "55", receivingTouchdowns: "1" },
    },
  ];
  const merged = mergePropsOnlySeasonLogs(current, prior);
  assert.ok(merged.length >= 4, `expected current+prior games, got ${merged.length}`);
  const yards = pick("player_reception_yds", "Kelce", 60.5, { athleteId: "15847" });
  const graded = gradeFootballPropFromHistory(normalizePropsOnlyPick(yards), {
    recent: merged,
  });
  assertUnapprovedHistoricalSeat(graded);
});

test("same-date pass/rush/rec category rows merge before TD grade", () => {
  const hist = {
    recent: [
      {
        date: "2026-09-20",
        opp: "Mia",
        stats: { passingTouchdowns: "2", passingYards: "250" },
      },
      {
        date: "2026-09-20",
        opp: "Mia",
        stats: { rushingTouchdowns: "0", rushingYards: "12" },
      },
      {
        date: "2026-09-13",
        opp: "Phi",
        stats: { passingTouchdowns: "1", passingYards: "220" },
      },
      {
        date: "2026-09-13",
        opp: "Phi",
        stats: { rushingTouchdowns: "1", rushingYards: "20" },
      },
    ],
  };
  const merged = mergePropsOnlyHistoryGames(hist.recent);
  assert.equal(merged.length, 2, "same-date category splits must collapse to one game");
  assert.equal(merged[0]?.stats?.passingTouchdowns, "2");
  assert.equal(merged[0]?.stats?.rushingTouchdowns, "0");
  const td = pick("player_anytime_td", "Mahomes", 0.5, { athleteId: "3139477" });
  const graded = gradeFootballPropFromHistory(normalizePropsOnlyPick(td), hist);
  assertUnapprovedHistoricalSeat(graded);
});

test("propsOnlyPriorSeasonYear prefers second available season", () => {
  assert.equal(propsOnlyPriorSeasonYear(["2026", "2025", "2024"]), "2025");
  assert.equal(propsOnlyPriorSeasonYear(["2026"]), "2025");
});

test("props-only: confidence below COACH_SIM_MIN_CONFIDENCE does not stage", () => {
  const scored: BoardScoredLeg[] = Array.from({ length: 8 }, (_, i) => {
    const p = {
      ...pick("player_points", `W${i}`, 16.5, { athleteId: `w-${i}`, odds: 115 }),
      sport: "wnba",
      game: `Away${i} @ Home${i}`,
      propsOnlyTicket: true,
    };
    return {
      pick: p,
      evPct: 20,
      edgePct: 20,
      confidencePct: 45,
      impliedProbPct: 46.5,
      lineShoppingScore: null,
      grade: "B",
      simHit: 0.7,
      composite: 7,
      rankScore: 7,
    } as BoardScoredLeg;
  });
  assert.equal(stageFootballPropsOnlyLegs(scored, 8).length, 0);
});

test("phone 3-of-8 rebuild: WNBA points props stage 8 legs via history EV (not confidence bar)", () => {
  const candidates: ParsedPick[] = [];
  const histories: Record<string, { recent: { stats: Record<string, string> }[] }> = {};

  for (let i = 0; i < 10; i++) {
    const name = `Scorer${i}`;
    const id = `wnba-${i}`;
    const game = `Away${i % 4} @ Home${i % 4}`;
    candidates.push({
      ...pick("player_points", name, 16.5, {
        athleteId: id,
        side: "Over",
        odds: 115,
      }),
      game,
      sport: "wnba",
      market: "Points",
    });
    candidates.push({
      ...pick("player_points", name, 16.5, {
        athleteId: id,
        side: "Under",
        odds: -135,
      }),
      game,
      sport: "wnba",
      market: "Points",
    });
    histories[`${name}#${id}`] = {
      recent: Array.from({ length: 8 }, () => ({
        stats: { PTS: "22" },
      })),
    };
  }

  // Selection must accept WNBA points (not football-family only).
  const selected = selectFootballPropsOnlyFromPicks(
    candidates,
    8,
    candidates.map(() => ({ sport: "wnba" })),
  );
  assert.ok(selected.length >= 8, `expected ≥8 WNBA candidates, got ${selected.length}`);
  assert.ok(selected.every((p) => p.propMarketKey === "player_points"));

  const hits = gradeFootballPropsOnlyFromHistory(selected, histories);
  for (const p of selected) {
    const seatHit = p.propSide === "Over" ? 0.72 : 0.28;
    setExact10kHitOnMap(hits, p, seatHit);
  }
  const best = collapsePropsOnlyToBestEvSides(selected, hits);
  const scored: BoardScoredLeg[] = best
    .map((p) => {
      const hit =
        hits.get(propsOnlySimLookupKey(normalizePropsOnlyPick(p), undefined) ?? "")
          ?.hitProbability ?? null;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      // Genuine conf at the shared floor — weak conf must not be manufactured upward.
      return stampPropsOnlyScoredLeg(
        {
          pick: {
            ...p,
            propsOnlyTicket: true,
            finalAiScore: {
              grade: "B",
              confidencePct: 55,
              edgePct: ((hit ?? 0) - 0.465) * 100,
            } as never,
          },
          evPct: ((hit ?? 0) - 0.465) * 100,
          edgePct: ((hit ?? 0) - 0.465) * 100,
          confidencePct: 55,
          impliedProbPct: 46.5,
          lineShoppingScore: null,
          grade: "B",
          simHit: hit,
          composite: 7,
          rankScore: 7,
        } as BoardScoredLeg,
        hit ?? 0.58,
      );
    })
    .filter((x): x is BoardScoredLeg => !!x);

  assert.ok(scored.length >= 8, `expected ≥8 WNBA legs clearing EV gate, got ${scored.length}`);
  const staged = stageFootballPropsOnlyLegs(scored, 8);
  assert.equal(
    staged.length,
    8,
    "8-leg player prop must fill from history EV — not stall at 3 via confidence bar",
  );
});

test("phone 7-leg thin slate: 1 game with 7 odds-cleared props stages all 7", () => {
  // Phone: PROPS_ONLY_STAGED_SHORT oddsOk=23 staged=3/7 — hard ≤3/game on Thursday.
  const scored: BoardScoredLeg[] = [];
  for (let i = 0; i < 7; i++) {
    const p = {
      ...pick("player_anytime_td", `RB${i}`, null, { athleteId: `rb-${i}`, odds: 200 + i * 10 }),
      game: "Los Angeles Rams @ Denver Broncos",
      propsOnlyTicket: true,
    };
    scored.push(
      stampPropsOnlyScoredLeg(
        {
          pick: p,
          evPct: 20 + i,
          edgePct: 20 + i,
          confidencePct: 52,
          impliedProbPct: 30,
          lineShoppingScore: null,
          grade: "B",
          simHit: 0.45,
          composite: 7,
          rankScore: 7 + i,
          // Grounded mid-sample reliability — not the thin longshot path.
          hitReliability: 0.7,
        } as BoardScoredLeg,
        0.45,
      ),
    );
  }
  assert.equal(propsOnlyPerGameCeiling(7, 1), 7);
  const staged = stageFootballPropsOnlyLegs(scored, 7);
  assert.equal(staged.length, 7, "thin 1-game slate must fill 7 props-only legs");
  assert.ok(staged.every((p) => p.propsOnlyTicket === true));
});

test("multi-game board: do not stack the same market+side on one game first", () => {
  // Phone: "5 leg NHL" → Werenski/Johnson/… Under 0.5 Points all from CBJ.
  const scored: BoardScoredLeg[] = [];
  const games = [
    "Buffalo Sabres @ Columbus Blue Jackets",
    "New Jersey Devils @ Pittsburgh Penguins",
    "San Jose Sharks @ Edmonton Oilers",
  ];
  for (let g = 0; g < games.length; g++) {
    for (let i = 0; i < 4; i++) {
      const p = {
        ...pick("player_points", `Skater${g}_${i}`, 0.5, {
          athleteId: `sk-${g}-${i}`,
          odds: -120,
          side: "Under" as const,
        }),
        game: games[g]!,
        propSide: "Under" as const,
        propsOnlyTicket: true,
      };
      scored.push(
        stampPropsOnlyScoredLeg(
          {
            pick: p,
            evPct: 30 - i - g,
            edgePct: 30 - i - g,
            confidencePct: 52,
            impliedProbPct: 54,
            lineShoppingScore: null,
            grade: "B",
            simHit: 0.7,
            composite: 7,
            rankScore: 7,
          } as BoardScoredLeg,
          0.7,
        ),
      );
    }
  }
  // Target ≤ games: prefer one Under Points from each matchup.
  const staged3 = stageFootballPropsOnlyLegs(scored, 3);
  assert.equal(staged3.length, 3);
  assert.equal(new Set(staged3.map((p) => p.game)).size, 3);
  // Target > games: may take a 2nd of the same market+side, but never 4 from one game.
  const staged5 = stageFootballPropsOnlyLegs(scored, 5);
  assert.equal(staged5.length, 5);
  const perGame = new Map<string, number>();
  for (const p of staged5) {
    const k = String(p.game ?? "");
    perGame.set(k, (perGame.get(k) ?? 0) + 1);
  }
  for (const [, n] of perGame) {
    assert.ok(n <= 2, `expected ≤2 same Under Points from one game, got ${n}`);
  }
});

test("propsOnlyPerGameCeiling: 2 games → ceil(target/2)", () => {
  assert.equal(propsOnlyPerGameCeiling(7, 2), 4);
  assert.equal(propsOnlyPerGameCeiling(10, 2), 5);
  assert.equal(propsOnlyPerGameCeiling(6, 3), 2);
});

test("phone 5-leg touchdown: stingy D cannot wipe graded Anytime TDs with no Under alt", () => {
  // Mirrors the graded-40 / staged-0 phone: binary TD Overs facing ≤16 pts/g
  // defenses had shouldPreferDefenseAltPick → pickDefenseAwareAlt(null) → [].
  const candidates: ParsedPick[] = [];
  const histories: Record<string, { recent: { stats: Record<string, string> }[] }> = {};
  for (let i = 0; i < 8; i++) {
    const name = `Scorer${i}`;
    const id = `scorer-${i}`;
    const game = `Away${i} @ Home${i}`;
    candidates.push({
      ...pick("player_anytime_td", name, 0.5, { athleteId: id, odds: 150 }),
      game,
      sport: "nfl",
    });
    histories[`${name}#${id}`] = {
      // 6/8 scoring games → shrunk rate still clears +150 implied after prior.
      recent: Array.from({ length: 8 }, (_, g) => ({
        stats: {
          rushingTouchdowns: "0",
          receivingTouchdowns: g < 6 ? "1" : "0",
          passingTouchdowns: "0",
        },
      })),
    };
  }

  const hits = gradeFootballPropsOnlyFromHistory(candidates, histories);
  for (const p of candidates) {
    setExact10kHitOnMap(hits, p, 0.58, 0.7);
  }
  const best = collapsePropsOnlyToBestEvSides(candidates, hits);
  assert.ok(best.length >= 5, `expected ≥5 graded TD sides, got ${best.length}`);

  // Every TD faces stingy D — must KEEP, not wipe.
  const kept = best.flatMap((p) => {
    assert.equal(
      shouldPreferDefenseAltPick({
        sport: "nfl",
        market: p.propMarketKey ?? p.market,
        side: p.propSide,
        pack: { pointsAgainst: 14 },
      }),
      false,
    );
    return [keepOrSwapDefenseAwareSide(p, best)];
  });
  assert.equal(kept.length, best.length);

  const scored: BoardScoredLeg[] = kept
    .map((p) => {
      const hit =
        hits.get(propsOnlySimLookupKey(normalizePropsOnlyPick(p), undefined) ?? "")
          ?.hitProbability ?? null;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      // Shrink can sit a hair under raw implied; stage still needs positive edge.
      const edgePct = Math.max(1.5, ((hit ?? 0) - 0.38) * 100);
      return stampPropsOnlyScoredLeg(
        {
          pick: {
            ...p,
            propsOnlyTicket: true,
            finalAiScore: {
              grade: "B",
              confidencePct: 60,
              edgePct,
              simHit: hit,
              simAligned: true,
              recommends: true,
              composite: 7,
            },
          },
          evPct: edgePct,
          edgePct,
          confidencePct: 60,
          impliedProbPct: 40,
          lineShoppingScore: null,
          grade: "B",
          simHit: hit,
          composite: 7,
          rankScore: 7,
          hitReliability: 0.7,
        } as BoardScoredLeg,
        hit ?? 0.58,
      );
    })
    .filter((x): x is BoardScoredLeg => !!x);

  assert.ok(scored.length >= 5, `expected ≥5 odds-cleared TDs, got ${scored.length}`);
  const staged = stageFootballPropsOnlyLegs(scored, 5);
  assert.equal(
    staged.length,
    5,
    `5-leg touchdown must stage real TDs — not "graded N none cleared" (got ${staged.length})`,
  );
  assert.ok(staged.every((p) => /anytime_td|touchdown/i.test(String(p.propMarketKey ?? p.market))));
});
