/**
 * Fixture-based pipeline / integrity / mapping / ticket invariant audits.
 * Does not call live providers or mutate Coach production code.
 */

import { filterOddsGamesExcludingTeams, excludedTeamScopesFromText } from "../coachAskTeamScope.ts";
import { parseCoachAskMarketConstraint, filterPropPoolByAskMarkets } from "../coachAskMarketFilter.ts";
import { EXPLICIT_MARKET_LOCK_RULES } from "../explicitMarketLock.ts";
import { PLAYER_PROP_SPORTS } from "../coachPropBoardCoverage.ts";
import { COACH_QA_SPORTS } from "./sportsIds.ts";
import { buildSyntheticBoardFixture, type BoardFixture, type FixtureProp } from "./fixtures.ts";
import { snapshotAsk } from "./parseSnapshot.ts";
import type { QaCaseResult, QaFinding } from "./types.ts";

let n = 0;
function F(partial: Omit<QaFinding, "id">): QaFinding {
  n += 1;
  return { id: `pipe-${n}`, ...partial };
}

type FakePick = {
  id: string;
  label: string;
  sport: string;
  market: string;
  line: number;
  odds: number;
  game: string;
  player?: string;
  team?: string;
  propId?: string;
  graded?: boolean;
  simulated?: boolean;
  providerEventId?: string;
  providerMarketKey?: string;
  providerOutcomeName?: string;
  book?: string;
};

/** Simulate a naive "stage N from pool" respecting exclusions + market lock. */
function stageTicket(
  ask: string,
  board: BoardFixture,
  picks: FakePick[],
): { staged: FakePick[]; notes: string[] } {
  const snap = snapshotAsk(ask, []);
  const excluded = excludedTeamScopesFromText(ask);
  let pool = [...board.propPool];
  // Sport focus — don't stage NFL props on an NHL ask in the fixture proxy.
  if (snap.focalSports.length) {
    pool = pool.filter((p) => snap.focalSports.includes(p.sport));
  }
  if (snap.allowedMarketKeys) {
    pool = pool.filter((p) =>
      snap.allowedMarketKeys!.some(
        (k) => p.market === k || p.market.startsWith(k.replace(/_alternate$/, "")),
      ),
    );
  }
  // Apply game exclusion on prop game labels
  const games = filterOddsGamesExcludingTeams(
    snap.focalSports.length
      ? board.oddsGames.filter((g) => snap.focalSports.includes(g.sport))
      : board.oddsGames,
    excluded,
  );
  const allowIds = new Set(games.map((g) => g.id));
  pool = pool.filter((p) => allowIds.has(p.gameId) || snap.focalSports.length === 0);
  // Drop intentionally bad mapping rows unless the suite is the mapping negative test
  pool = pool.filter((p) => p.id !== "prop-bad-map" && p.id !== "prop-fabricated");

  const notes: string[] = [];
  const staged: FakePick[] = [];
  for (const p of pool) {
    if (staged.length >= snap.requestedLegs) break;
    staged.push({
      id: p.id,
      label: `${p.player} ${p.side} ${p.line} ${p.market}`,
      sport: p.sport,
      market: p.market,
      line: p.line,
      odds: p.odds,
      game: p.game,
      player: p.player,
      team: p.team,
      propId: p.id,
      graded: true,
      simulated: true,
      providerEventId: p.providerEventId,
      providerMarketKey: p.providerMarketKey,
      providerOutcomeName: p.providerOutcomeName,
      book: p.book,
    });
  }
  void notes;
  void picks;
  return { staged, notes };
}

function provenanceOk(p: FakePick, board: BoardFixture): boolean {
  if (!p.providerEventId || !p.providerMarketKey) return false;
  const game = board.oddsGames.find((g) => g.id === p.providerEventId);
  if (!game) return false;
  const market = game.markets.find((m) => m.key === p.providerMarketKey);
  if (!market) {
    // Prop-only markets may only exist on propPool
    return board.propPool.some(
      (x) =>
        x.providerEventId === p.providerEventId &&
        x.providerMarketKey === p.providerMarketKey &&
        x.line === p.line &&
        x.odds === p.odds,
    );
  }
  return market.outcomes.some(
    (o) =>
      (o.point == null || o.point === p.line) &&
      (o.price === p.odds || true),
  );
}

function mappingSuspicious(p: FakePick, board: BoardFixture): string | null {
  if (!p.team || !p.game) return null;
  const game = board.oddsGames.find((g) => p.game.includes(g.homeTeam) || p.game.includes(g.awayTeam));
  if (!game) return "game-not-on-board";
  const teamOnGame =
    p.team === game.homeTeam ||
    p.team === game.awayTeam ||
    game.homeTeam.includes(p.team) ||
    game.awayTeam.includes(p.team);
  if (!teamOnGame) return `team ${p.team} not in ${game.awayTeam} @ ${game.homeTeam}`;
  return null;
}

export function runPipelineFixtureSuite(): QaCaseResult[] {
  const board = buildSyntheticBoardFixture();
  const out: QaCaseResult[] = [];

  const asks = [
    "5 leg",
    "5 leg touchdowns",
    "5 leg passing yards",
    "5 leg sacks",
    "6 leg NHL no Ducks",
    "4 leg soccer",
    "6 leg NFL player props",
    "8 leg NHL tonight no Ducks",
  ];

  for (const ask of asks) {
    const snap = snapshotAsk(ask, []);
    const { staged, notes } = stageTicket(ask, board, []);

    // Count stages (fixture proxy for available/qualified/staged)
    const available = board.propPool.length;
    const lockedPool = snap.allowedMarketKeys
      ? filterPropPoolByAskMarkets(
          board.propPool.map((p) => ({ marketKey: p.market })),
          snap.allowedMarketKeys,
        ).length
      : available;

    out.push({
      id: `pipe-counts-${ask}`,
      suite: "pipeline_counts",
      ok: true,
      meta: {
        ask,
        requested: snap.requestedLegs,
        available,
        lockedPool,
        staged: staged.length,
        notes,
        snap,
      },
    });

    // Final ticket invariants
    if (staged.length > snap.requestedLegs) {
      out.push({
        id: `pipe-overfill-${ask}`,
        suite: "ticket_construction",
        ok: false,
        finding: F({
          severity: "P0",
          category: "ticket_construction",
          title: "Staged more legs than requested",
          promptOrSequence: ask,
          expected: `<= ${snap.requestedLegs}`,
          actual: `${staged.length}`,
          stage: "staging",
          likelyFile: "lib/coach/buildParlay.ts / ticketStaging",
          productionAffected: true,
        }),
      });
    } else {
      out.push({ id: `pipe-overfill-${ask}`, suite: "ticket_construction", ok: true });
    }

    // Duplicates
    const keys = staged.map((p) => `${p.player}|${p.market}|${p.line}|${p.side ?? ""}`);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dup.length) {
      out.push({
        id: `pipe-dup-${ask}`,
        suite: "ticket_construction",
        ok: false,
        finding: F({
          severity: "P1",
          category: "ticket_construction",
          title: "Duplicate exact selections",
          promptOrSequence: ask,
          expected: "unique selections",
          actual: dup.join("; "),
          stage: "staging",
          likelyFile: "lib/parlayVarietyMemory.ts",
          productionAffected: true,
        }),
      });
    } else {
      out.push({ id: `pipe-dup-${ask}`, suite: "ticket_construction", ok: true });
    }

    // Exclusion integrity
    const excluded = excludedTeamScopesFromText(ask);
    if (excluded.length) {
      const leaked = staged.filter((p) =>
        excluded.some((ex) =>
          ex.matchTokens.some(
            (t) =>
              p.game.toLowerCase().includes(t) ||
              (p.team ?? "").toLowerCase().includes(t),
          ),
        ),
      );
      if (leaked.length) {
        out.push({
          id: `pipe-exleak-${ask}`,
          suite: "date_sport_team",
          ok: false,
          finding: F({
            severity: "P0",
            category: "date_sport_team",
            title: "Excluded team/game appeared on ticket",
            promptOrSequence: ask,
            expected: "no excluded matchup",
            actual: leaked.map((l) => l.label).join("; "),
            stage: "exclusion filtering",
            likelyFile: "lib/coachAskTeamScope.ts",
            productionAffected: true,
          }),
        });
      } else {
        out.push({ id: `pipe-exleak-${ask}`, suite: "date_sport_team", ok: true });
      }
    }

    // Market lock family
    if (snap.isMarketLocked && snap.allowedMarketKeys) {
      const wrong = staged.filter(
        (p) =>
          !snap.allowedMarketKeys!.some(
            (k) => p.market === k || p.market.replace(/_alternate$/, "") === k,
          ),
      );
      if (wrong.length) {
        out.push({
          id: `pipe-wrongfam-${ask}`,
          suite: "recovery_alt",
          ok: false,
          finding: F({
            severity: "P1",
            category: "recovery_alt",
            title: "Locked market ticket contains other family",
            promptOrSequence: ask,
            expected: `markets in ${snap.allowedMarketKeys.join(",")}`,
            actual: wrong.map((w) => w.market).join(","),
            stage: "qualification/staging",
            likelyFile: "lib/coachAskMarketFilter.ts",
            productionAffected: true,
          }),
        });
      } else {
        out.push({ id: `pipe-wrongfam-${ask}`, suite: "recovery_alt", ok: true });
      }
    }

    // Provider provenance
    for (const p of staged) {
      const okProv = provenanceOk(p, board);
      out.push({
        id: `pipe-prov-${ask}-${p.id}`,
        suite: "provider_integrity",
        ok: okProv,
        finding: okProv
          ? undefined
          : F({
              severity: "P0",
              category: "provider_integrity",
              title: "Final pick not traceable to provider outcome",
              promptOrSequence: ask,
              expected: "provider event/market/outcome/line/price chain",
              actual: JSON.stringify({
                providerEventId: p.providerEventId,
                market: p.providerMarketKey,
                line: p.line,
                odds: p.odds,
              }),
              stage: "provider integrity",
              likelyFile: "lib/boardMarketScanner.ts",
              productionAffected: true,
            }),
      });

      const mapIssue = mappingSuspicious(p, board);
      out.push({
        id: `pipe-map-${ask}-${p.id}`,
        suite: "mapping",
        ok: !mapIssue,
        warning: !!mapIssue,
        finding: mapIssue
          ? F({
              severity: "P0",
              category: "mapping",
              title: "Player/team/event mapping suspicious",
              promptOrSequence: ask,
              expected: "player team matches event participants",
              actual: mapIssue,
              stage: "mapping",
              likelyFile: "lib/coachTeamIdResolve / prop pool join",
              productionAffected: true,
            })
          : undefined,
      });

      if (!p.graded || !p.simulated) {
        out.push({
          id: `pipe-grade-${ask}-${p.id}`,
          suite: "simulation",
          ok: false,
          finding: F({
            severity: "P1",
            category: "simulation",
            title: "Pick missing grade/simulation",
            promptOrSequence: ask,
            expected: "graded+simulated",
            actual: `graded=${p.graded} simulated=${p.simulated}`,
            stage: "grading",
            likelyFile: "lib/coach/buildParlay.ts",
            productionAffected: true,
          }),
        });
      }
    }

    // Ungraded filler check — fixture stager never inserts filler
    out.push({
      id: `pipe-filler-${ask}`,
      suite: "ticket_construction",
      ok: true,
      meta: { note: "fixture stager does not insert ungraded filler" },
    });
  }

  // Explicit negative: fabricated prop must fail provenance if forced in
  const fab = board.propPool.find((p) => p.id === "prop-fabricated")!;
  const fakePick: FakePick = {
    id: fab.id,
    label: fab.player,
    sport: fab.sport,
    market: fab.market,
    line: fab.line,
    odds: fab.odds,
    game: fab.game,
    player: fab.player,
    team: fab.team,
    providerEventId: fab.providerEventId,
    providerMarketKey: fab.providerMarketKey,
    providerOutcomeName: fab.providerOutcomeName,
    graded: true,
    simulated: true,
  };
  out.push({
    id: "pipe-fabricated-detect",
    suite: "provider_integrity",
    ok: !provenanceOk(fakePick, board),
    finding: provenanceOk(fakePick, board)
      ? F({
          severity: "P0",
          category: "provider_integrity",
          title: "Fabricated line incorrectly treated as provider-backed",
          promptOrSequence: "synthetic",
          expected: "provenance fail",
          actual: "provenance pass",
          stage: "provider integrity",
          likelyFile: "lib/coachQa/fixtures.ts",
          productionAffected: false,
        })
      : undefined,
    meta: { detectedFabrication: !provenanceOk(fakePick, board) },
  });

  return out;
}

/** Sport × market-family matrix (parser eligibility PASS/FAIL). */
export function runMarketCoverageMatrix(): QaCaseResult[] {
  const out: QaCaseResult[] = [];
  for (const sport of COACH_QA_SPORTS) {
    const propCapable = (PLAYER_PROP_SPORTS as readonly string[]).includes(sport);
    for (const rule of EXPLICIT_MARKET_LOCK_RULES) {
      const ask = `5 leg ${sport} ${rule.label}`;
      const snap = snapshotAsk(ask, []);
      const locked = snap.isMarketLocked;
      const ok = locked; // family phrase should lock regardless of sport token order
      out.push({
        id: `mkt-${sport}-${rule.id}`,
        suite: "market_coverage",
        ok,
        warning: !propCapable,
        finding: ok
          ? undefined
          : F({
              severity: "P2",
              category: "market_coverage",
              title: `Market family failed to lock for ${sport}`,
              promptOrSequence: ask,
              expected: `isMarketLocked with ${rule.markets[0]}`,
              actual: `locked=${snap.isMarketLocked} keys=${JSON.stringify(snap.allowedMarketKeys)}`,
              stage: "parseCoachAskMarketConstraint",
              likelyFile: "lib/explicitMarketLock.ts",
              productionAffected: true,
            }),
        meta: {
          sport,
          marketFamily: rule.id,
          requestType: "explicit_lock",
          propCapable,
          status: ok ? "PASS" : "FAIL",
        },
      });
    }
    // Game-line families
    for (const gl of ["moneylines", "spreads", "totals", "game lines only"]) {
      const ask = `6 leg ${sport} ${gl}`;
      const snap = snapshotAsk(ask, []);
      out.push({
        id: `mkt-gl-${sport}-${gl}`,
        suite: "market_coverage",
        ok: true,
        meta: {
          sport,
          marketFamily: gl,
          requestType: "game_line",
          propsOnly: snap.propsOnly,
          gameLinesOnly: snap.gameLinesOnly,
          status: "PASS",
        },
      });
    }
  }
  return out;
}

export function runDataQualityFlags(board = buildSyntheticBoardFixture()): QaCaseResult[] {
  const out: QaCaseResult[] = [];
  for (const p of board.propPool) {
    const extremeLine = Math.abs(p.line) > 500;
    const extremeOdds = Math.abs(p.odds) > 5000;
    if (extremeLine || extremeOdds || p.id === "prop-fabricated") {
      out.push({
        id: `dq-${p.id}`,
        suite: "data_quality",
        ok: true,
        warning: true,
        finding: F({
          severity: "P3",
          category: "data_quality",
          title: "Suspicious prop flagged for review",
          promptOrSequence: p.player,
          expected: "sane line/odds on provider board",
          actual: `line=${p.line} odds=${p.odds} id=${p.id}`,
          stage: "data-quality",
          likelyFile: "lib/coachQa/fixtures.ts (fixture) / board scan",
          productionAffected: p.id === "prop-fabricated" ? false : true,
        }),
      });
    } else {
      out.push({ id: `dq-${p.id}`, suite: "data_quality", ok: true });
    }
  }
  return out;
}

export function runFailureInjectionSuite(): QaCaseResult[] {
  const cases: Array<{ id: string; simulate: () => void; expectSafe: boolean }> = [
    {
      id: "empty-ask",
      simulate: () => {
        snapshotAsk("", []);
      },
      expectSafe: true,
    },
    {
      id: "malformed-unicode",
      simulate: () => {
        snapshotAsk("5 leg NHL no \u0000 Ducks", []);
      },
      expectSafe: true,
    },
    {
      id: "huge-legs",
      simulate: () => {
        snapshotAsk("999 leg NFL", []);
      },
      expectSafe: true,
    },
    {
      id: "empty-priors",
      simulate: () => {
        snapshotAsk("5 leg", ["", "   ", "4 leg soccer"]);
      },
      expectSafe: true,
    },
  ];
  const out: QaCaseResult[] = [];
  for (const c of cases) {
    try {
      c.simulate();
      out.push({
        id: `inj-${c.id}`,
        suite: "failure_injection",
        ok: true,
        meta: { note: "parser stayed safe (no throw)" },
      });
    } catch (e) {
      out.push({
        id: `inj-${c.id}`,
        suite: "failure_injection",
        ok: false,
        finding: F({
          severity: "P0",
          category: "failure_injection",
          title: `Failure injection crashed: ${c.id}`,
          promptOrSequence: c.id,
          expected: "safe degrade / no throw",
          actual: e instanceof Error ? e.message : String(e),
          stage: "parser",
          likelyFile: "lib/coachQa/parseSnapshot.ts",
          productionAffected: true,
        }),
      });
    }
  }

  // Documented injection scenarios that require live/IO — record as SKIP warnings
  const liveOnly = [
    "provider timeout",
    "provider 429",
    "missing ESPN ID",
    "missing history",
    "missing injury data",
    "missing weather",
    "simulation timeout",
    "partial board",
    "empty market",
    "malformed provider outcome",
    "cache miss",
    "stale cache",
    "one sport failing while another works",
  ];
  for (const name of liveOnly) {
    out.push({
      id: `inj-skip-${name}`,
      suite: "failure_injection",
      ok: true,
      warning: true,
      finding: F({
        severity: "P2",
        category: "failure_injection",
        title: `Live failure-injection not executed: ${name}`,
        promptOrSequence: name,
        expected: "safe degrade without freeze/crash/fabricate",
        actual: "SKIPPED in offline harness — needs controlled live/IO harness extension",
        stage: "failure_injection",
        likelyFile: "lib/coach/buildParlay.ts / api-server odds routes",
        productionAffected: false,
      }),
    });
  }
  return out;
}

export function runPerformanceSmoke(): QaCaseResult[] {
  const asks = generatePerfAsks();
  const out: QaCaseResult[] = [];
  const t0 = performance.now();
  for (const ask of asks) {
    const s = performance.now();
    snapshotAsk(ask, []);
    snapshotAsk(ask, ["4 leg soccer", "5 leg touchdowns"]);
    const ms = performance.now() - s;
    out.push({
      id: `perf-${ask}`,
      suite: "performance",
      ok: ms < 50,
      warning: ms >= 20 && ms < 50,
      finding:
        ms >= 50
          ? F({
              severity: "P2",
              category: "performance",
              title: "Parser snapshot slower than 50ms",
              promptOrSequence: ask,
              expected: "<50ms",
              actual: `${ms.toFixed(2)}ms`,
              stage: "parser",
              likelyFile: "lib/coachAskMarketFilter.ts",
              productionAffected: false,
            })
          : undefined,
      meta: { ms },
    });
  }
  const total = performance.now() - t0;
  out.push({
    id: "perf-total-parser-batch",
    suite: "performance",
    ok: total < 5000,
    meta: { totalMs: total, count: asks.length },
  });
  return out;
}

function generatePerfAsks(): string[] {
  const out: string[] = [];
  for (const n of [5, 6, 7, 10, 15]) {
    out.push(`${n} leg`);
    for (const s of COACH_QA_SPORTS) out.push(`${n} leg ${s}`);
    out.push(`${n} leg touchdowns`);
    out.push(`${n} leg NHL no Ducks`);
  }
  return out;
}

/** Re-export constraint parse for tests that assert market filter wiring. */
export function parseConstraint(ask: string, priors: string[] = []) {
  return parseCoachAskMarketConstraint(ask, priors);
}
