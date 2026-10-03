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
} from "./coachFootballPropsOnlyGrade.ts";
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
  } as ParsedPick;
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

test("binary TD 0/1 soft-clip clears sim grade admission", () => {
  const p = {
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propLine: 0.5,
    isProp: true,
    sport: "nfl",
  };
  assert.equal(pickHasSimGrade(p, 0), false);
  assert.equal(pickHasSimGrade(p, clipPropSimHitForGrade(p, 0)), true);
  assert.equal(pickHasSimGrade(p, clipPropSimHitForGrade(p, 1)), true);
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
  assert.ok(propsOnlyPickHasGrade(pass, hits), "pass yards must clear sim grade from history");
  assert.ok(propsOnlyPickHasGrade(td, hits), "anytime TD must clear after soft-clip");
  assert.ok(propsOnlyPickHasGrade(rush, hits), "rush yards must clear sim grade from history");

  const tdHit = gradeFootballPropFromHistory(td, histories["Kelce#15847"]);
  assert.ok(tdHit.hitProbability != null && tdHit.hitProbability > 0 && tdHit.hitProbability < 1);
});

test("null-line TD grades from history after normalize (phone #541 path)", () => {
  const td = pick("player_anytime_td", "Kelce", null, { athleteId: "15847" });
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
  assert.ok(graded.hitProbability != null, "null-line TD must grade at 0.5");
  assert.equal(propsOnlyLegClearsOdds(normalizePropsOnlyPick(td), graded.hitProbability), true);
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
  const hit = [...hits.values()][0]?.hitProbability ?? null;
  assert.ok(hit != null && hit > 0.9, `expected high over-hit, got ${hit}`);
  assert.equal(propsOnlyLegClearsOdds(pass, hit), true);
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
  const overHit = gradeFootballPropFromHistory(over, histories["Mahomes#3139477"]);
  const underHit = gradeFootballPropFromHistory(under, histories["Mahomes#3139477"]);
  assert.equal(propsOnlyLegClearsOdds(over, overHit.hitProbability), false);
  assert.equal(propsOnlyLegClearsOdds(under, underHit.hitProbability), true);
  const collapsed = collapsePropsOnlyToBestEvSides([over, under], hits);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].propSide, "Under");
  assert.equal(propsOnlyLegClearsOdds(collapsed[0], underHit.hitProbability), true);
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
  const mainHit = gradeFootballPropFromHistory(main, histories["Henry#henry-1"]);
  const altHit = gradeFootballPropFromHistory(alt, histories["Henry#henry-1"]);
  assert.equal(propsOnlyLegClearsOdds(main, mainHit.hitProbability), false);
  assert.equal(propsOnlyLegClearsOdds(alt, altHit.hitProbability), true);
  const collapsed = collapsePropsOnlyToBestEvSides([main, alt], hits);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].propLine, 49.5);
  assert.equal(collapsed[0].propIsAlt, true);
  assert.ok(
    propsOnlyLegClearsOdds(collapsed[0], altHit.hitProbability),
    "alt rung that clears odds must win the ladder",
  );

  const scored: BoardScoredLeg[] = [
    {
      pick: { ...collapsed[0], propsOnlyTicket: true },
      evPct: 10,
      edgePct: 10,
      confidencePct: 60,
      impliedProbPct: 52,
      lineShoppingScore: null,
      grade: "B",
      simHit: altHit.hitProbability,
      composite: 7,
      rankScore: 7,
    } as BoardScoredLeg,
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
  const mainHit = gradeFootballPropFromHistory(main, histories["Barkley#sb-1"]);
  const altHit = gradeFootballPropFromHistory(alt, histories["Barkley#sb-1"]);
  assert.equal(propsOnlyLegClearsOdds(main, mainHit.hitProbability), false);
  assert.equal(propsOnlyLegClearsOdds(alt, altHit.hitProbability), true);
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
  const best = collapsePropsOnlyToBestEvSides(candidates, hits);
  assert.ok(best.length >= 8, `expected ≥8 best-EV sides, got ${best.length}`);

  const scored: BoardScoredLeg[] = best
    .map((p) => {
      const hit = gradeFootballPropFromHistory(
        p,
        histories[`${p.player}#${p.athleteId}`],
      ).hitProbability;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      return {
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
      } as BoardScoredLeg;
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
  assert.ok(graded.hitProbability != null, `expected grade from 2 games, got ${graded.nullReason}`);
  assert.equal(graded.nullReason, null);
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
  assert.ok(
    graded.hitProbability != null,
    `prior-season backfill must grade, got ${graded.nullReason}`,
  );
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
  assert.ok(graded.hitProbability != null, `merged TD grade failed: ${graded.nullReason}`);
});

test("propsOnlyPriorSeasonYear prefers second available season", () => {
  assert.equal(propsOnlyPriorSeasonYear(["2026", "2025", "2024"]), "2025");
  assert.equal(propsOnlyPriorSeasonYear(["2026"]), "2025");
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
  const best = collapsePropsOnlyToBestEvSides(selected, hits);
  const scored: BoardScoredLeg[] = best
    .map((p) => {
      const hit = gradeFootballPropFromHistory(
        p,
        histories[`${p.player}#${p.athleteId}`],
      ).hitProbability;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      // Simulate thin context (43% grounded / conf 45) — history EV path still stages.
      return {
        pick: { ...p, finalAiScore: { confidencePct: 45 } as never },
        evPct: ((hit ?? 0) - 0.465) * 100,
        edgePct: ((hit ?? 0) - 0.465) * 100,
        confidencePct: 45,
        impliedProbPct: 46.5,
        lineShoppingScore: null,
        grade: "B",
        simHit: hit,
        composite: 7,
        rankScore: 7,
      } as BoardScoredLeg;
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
    scored.push({
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
    } as BoardScoredLeg);
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
      scored.push({
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
      } as BoardScoredLeg);
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
      const hit = gradeFootballPropFromHistory(
        p,
        histories[`${p.player}#${p.athleteId}`],
      ).hitProbability;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      return {
        pick: { ...p, propsOnlyTicket: true },
        evPct: ((hit ?? 0) - 0.4) * 100,
        edgePct: ((hit ?? 0) - 0.4) * 100,
        confidencePct: 60,
        impliedProbPct: 40,
        lineShoppingScore: null,
        grade: "B",
        simHit: hit,
        composite: 7,
        rankScore: 7,
      } as BoardScoredLeg;
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
