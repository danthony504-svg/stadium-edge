#!/usr/bin/env node
/**
 * Live audit: exact ask "7 leg college football player props".
 *
 * Rejection buckets:
 *   missing_history_context | simulation_failure | stamp_rejection |
 *   unsupported_market | odds_range | grade | confidence | edge | correlation
 *
 * Run (from artifacts/stadium-mobile):
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *     node --import ./test/register-hooks.mjs scripts/ncaafCollegePropsFunnelAudit.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const u = (rel) => pathToFileURL(path.join(root, rel)).href;

process.chdir(root);
process.env.EXPO_PUBLIC_DOMAIN =
  process.env.EXPO_PUBLIC_DOMAIN || "stadium-edge.onrender.com";
process.env.PROPS_ONLY_STAGE_AUDIT = process.env.PROPS_ONLY_STAGE_AUDIT || "1";

const ASK =
  process.env.NCAAF_PROPS_AUDIT_ASK || "7 leg college football player props";
const TARGET = Number(process.env.NCAAF_PROPS_AUDIT_LEGS || 7);
const OUT =
  process.env.NCAAF_PROPS_AUDIT_OUT ||
  "/opt/cursor/artifacts/ncaaf-college-props-funnel-audit.json";

const { buildCoachParlay } = await import(u("lib/coach/buildParlay.ts"));
const {
  parseCoachAskMarketConstraint,
  filterPropPoolByAskMarkets,
} = await import(u("lib/coachAskMarketFilter.ts"));
const {
  askAllowsNcaafPlayerProps,
  filterNcaafPlayerPropsUnlessAsked,
  askIsCollegeFootballOnly,
} = await import(u("lib/boardScanPropDelivery.ts"));
const { coachBoardSportsForAsk } = await import(
  u("lib/coachPropBoardCoverage.ts")
);
const { DEFAULT_SPORTS } = await import(u("lib/sports.ts"));
const {
  getGames,
  getOdds,
  getLiveOdds,
  fetchFullBoardPropPool,
} = await import(u("lib/api.ts"));
const {
  filterBettableOddsGames,
  slateDayFromThread,
  filterOddsGamesForSlateDay,
  filterOddsForSlateDay,
} = await import(u("lib/slate.ts"));
const {
  coachAskTeamScope,
  excludedTeamScopesFromText,
  resolveExcludedTeamIdsFromGames,
  filterOddsGamesForCoachAskTeams,
  filterPicksForCoachAskTeams,
} = await import(u("lib/coachAskTeamScope.ts"));
const { parsedPickFromPoolEntry } = await import(u("lib/propSelection.ts"));
const { isFootballPropsOnlyCandidate } = await import(
  u("lib/coachFootballPropsOnly.ts")
);
const {
  selectFootballPropsOnlyCandidates,
  buildFootballPropsOnlyTicket,
} = await import(u("lib/coachFootballPropsOnlyTicket.ts"));
const {
  normalizePropsOnlyPick,
  propsOnlyPoolRowForPick,
  propsOnlySimLookupKey,
  propsOnlyLegClearsOdds,
  propsOnlyEffectiveLine,
  PROPS_ONLY_ODDS_SLACK,
} = await import(u("lib/coachFootballPropsOnlyGrade.ts"));
const { marketSupportsSimulation } = await import(u("lib/simMarketSupport.ts"));
const { evaluateCoachQualification } = await import(
  u("lib/coach/qualifyCoachCandidate.ts")
);
const { takePropsOnlyStageAudit } = await import(
  u("lib/coachFootballPropsOnly.ts")
);

const BUCKETS = [
  "missing_history_context",
  "simulation_failure",
  "stamp_rejection",
  "unsupported_market",
  "odds_range",
  "grade",
  "confidence",
  "edge",
  "correlation",
];

function emptyBuckets() {
  return Object.fromEntries(BUCKETS.map((k) => [k, 0]));
}

function bump(map, key, n = 1) {
  map[key] = (map[key] ?? 0) + n;
}

function classifyNullReason(reason) {
  const r = String(reason || "");
  if (
    /no_player_history|insufficient_game_log|insufficient_mapped_stats|incomplete_prop|missing_athlete|no_candidates|no_lookup_key|anytime_td_insufficient|rare_count_insufficient|ungraded/.test(
      r,
    )
  ) {
    return "missing_history_context";
  }
  if (/sim_|simulation|mc_|deep_sim|server_sim|engine/.test(r)) {
    return "simulation_failure";
  }
  if (/stamp|engine_version|sport_mismatch|foreign_sport/.test(r)) {
    return "stamp_rejection";
  }
  if (/unsupported|sim_unsupported/.test(r)) return "unsupported_market";
  return "missing_history_context";
}

function sportOf(row) {
  return String(row?.sport ?? "").toLowerCase();
}

function isNcaaf(sport) {
  const s = String(sport ?? "").toLowerCase();
  return s === "ncaaf" || s === "cfb" || s.includes("ncaaf");
}

function pickTrace(p, extra = {}) {
  return {
    sport: p.sport ?? null,
    player: p.player ?? null,
    market: p.market ?? null,
    propMarketKey: p.propMarketKey ?? null,
    line: p.propLine ?? p.line ?? null,
    side: p.propSide ?? p.side ?? null,
    odds: p.odds ?? null,
    isAlt: !!p.propIsAlt,
    ticketRole: p.ticketRole ?? (p.propIsAlt ? "alt" : "main"),
    game: p.game ?? null,
    athleteId: p.athleteId ?? null,
    grade: p.finalAiScore?.grade ?? p.grade ?? null,
    confidencePct: p.finalAiScore?.confidencePct ?? p.confidencePct ?? null,
    edgePct: p.finalAiScore?.edgePct ?? p.edgePct ?? null,
    simHit: p.finalAiScore?.simHit ?? p.simHit ?? null,
    ...extra,
  };
}

async function loadInputs(ask, legs, signal, onStatus) {
  const sports = coachBoardSportsForAsk(ask, legs, DEFAULT_SPORTS);
  onStatus?.(
    sports.length === 1
      ? `Loading ${sports[0].toUpperCase()} board…`
      : "Loading tonight's board…",
  );
  const [espnGamesRaw, oddsRaw] = await Promise.all([
    Promise.all(
      sports.map((s) => getGames(s, signal).catch(() => [])),
    ).then((r) => r.flat()),
    Promise.all(
      sports.map((s) => getOdds(s, signal).catch(() => [])),
    ).then((r) => filterBettableOddsGames(r.flat())),
  ]);
  // Lightweight stamp check: rows tagged to a different sport than requested.
  let stampDrops = 0;
  if (sports.length === 1) {
    const want = sports[0];
    for (const g of [...espnGamesRaw, ...oddsRaw]) {
      const s = sportOf(g);
      if (s && s !== want && !(want === "ncaaf" && (s === "cfb" || s.includes("ncaaf")))) {
        stampDrops += 1;
      }
    }
  }
  const teamScope = coachAskTeamScope(ask);
  let excludedTeams = excludedTeamScopesFromText(ask);
  excludedTeams = resolveExcludedTeamIdsFromGames(excludedTeams, espnGamesRaw);
  const slateDay = slateDayFromThread(ask ?? "", []);
  let oddsGames = filterOddsGamesForSlateDay(
    filterOddsGamesForCoachAskTeams(oddsRaw, teamScope, excludedTeams),
    slateDay,
  );
  let espnGames = filterOddsForSlateDay(
    filterOddsGamesForCoachAskTeams(espnGamesRaw, teamScope, excludedTeams),
    slateDay,
  );
  onStatus?.("Loading player props and alt lines…");
  let propPool = await fetchFullBoardPropPool(
    oddsGames,
    espnGames,
    [],
    signal,
  ).catch(() => []);
  propPool = filterOddsForSlateDay(propPool, slateDay);
  propPool = filterPicksForCoachAskTeams(propPool, teamScope, excludedTeams);
  return {
    sports,
    oddsGames,
    espnGames,
    propPool,
    stampDrops,
    slateDay,
  };
}

console.error("[audit] ask=", ASK, "target=", TARGET);
console.error("[audit] domain=", process.env.EXPO_PUBLIC_DOMAIN);
console.error(
  "[audit] askAllowsNcaafPlayerProps=",
  askAllowsNcaafPlayerProps(ASK),
  "collegeOnly=",
  askIsCollegeFootballOnly(ASK),
);

const t0 = Date.now();
const ac = new AbortController();
const hard = setTimeout(() => ac.abort(), 240_000);
const statuses = [];
const rejectionCounts = emptyBuckets();
const rejectionDetail = Object.fromEntries(BUCKETS.map((k) => [k, {}]));
const bumpDetail = (bucket, key) => {
  bump(rejectionCounts, bucket);
  bump(rejectionDetail[bucket], key);
};

process.on("unhandledRejection", (err) => {
  console.error("[audit] unhandledRejection (swallowed)", err?.message || err);
});

try {
  const inputs = await loadInputs(ASK, TARGET, ac.signal, (s) => {
    statuses.push(s);
    console.error("[status]", s);
  });

  const marketConstraint = parseCoachAskMarketConstraint(ASK, []);
  const allowedKeys = Array.isArray(marketConstraint.allowedMarketKeys)
    ? marketConstraint.allowedMarketKeys
    : null;
  const scanPropPool = allowedKeys
    ? filterPropPoolByAskMarkets(inputs.propPool, allowedKeys)
    : inputs.propPool;
  const activePropPool = askAllowsNcaafPlayerProps(ASK)
    ? scanPropPool
    : filterNcaafPlayerPropsUnlessAsked(scanPropPool, ASK);

  rejectionCounts.stamp_rejection = inputs.stampDrops;
  rejectionDetail.stamp_rejection = { cross_sport_row_tag: inputs.stampDrops };

  const poolSports = {};
  for (const e of activePropPool) bump(poolSports, sportOf(e) || "unknown");
  const nonNcaafInPool = activePropPool.filter((e) => !isNcaaf(sportOf(e)));

  const allParsed = activePropPool.map((e) =>
    normalizePropsOnlyPick(parsedPickFromPoolEntry(e)),
  );
  let missingOdds = 0;
  let unsupported = 0;
  let missingLine = 0;
  let missingAthlete = 0;
  let candOk = 0;
  for (const p of allParsed) {
    if (!p.isProp) continue;
    if (p.odds == null || !Number.isFinite(p.odds) || p.odds === 0) {
      missingOdds += 1;
      bumpDetail("odds_range", "missing_odds");
      continue;
    }
    if (!marketSupportsSimulation(p.market ?? "", p)) {
      unsupported += 1;
      bumpDetail("unsupported_market", p.propMarketKey || p.market || "unknown");
      continue;
    }
    const line = propsOnlyEffectiveLine(p);
    if (line == null || !Number.isFinite(line)) {
      missingLine += 1;
      bumpDetail("missing_history_context", "missing_prop_line");
      continue;
    }
    const side =
      p.propSide === "Under" || p.propSide === "Over" ? p.propSide : null;
    if (!side) {
      missingLine += 1;
      bumpDetail("missing_history_context", "missing_prop_side");
      continue;
    }
    if (!p.athleteId) {
      missingAthlete += 1;
      bumpDetail("missing_history_context", "missing_athlete_id");
      continue;
    }
    if (!isFootballPropsOnlyCandidate(p)) {
      bumpDetail("unsupported_market", "failed_candidate_gate");
      continue;
    }
    candOk += 1;
  }

  const candidates = selectFootballPropsOnlyCandidates(activePropPool, TARGET);
  const candidateSports = {};
  for (const c of candidates) bump(candidateSports, sportOf(c) || "unknown");
  const nonNcaafCandidates = candidates.filter((c) => !isNcaaf(sportOf(c)));
  const notSelected = Math.max(0, candOk - candidates.length);

  console.error(
    `[audit] candidates=${candidates.length} pool=${activePropPool.length}`,
  );
  console.error("[audit] buildFootballPropsOnlyTicket…");
  const built = await buildFootballPropsOnlyTicket({
    target: TARGET,
    pool: activePropPool,
    realOdds: [],
    teamIdMap: new Map(),
    signal: ac.signal,
    askText: ASK,
    onStatus: (s) => {
      statuses.push(s);
      console.error("[status]", s);
    },
  });
  // Consume leftover audit if ticket builder already took it.
  takePropsOnlyStageAudit();

  const fail = built.failDiag;
  const nullReasons = fail?.nullReasons ?? {};
  for (const [reason, count] of Object.entries(nullReasons)) {
    const n = Number(count) || 0;
    for (let i = 0; i < n; i++) {
      bumpDetail(classifyNullReason(reason), reason);
    }
  }

  if (fail) {
    const oddsGate = Math.max(
      0,
      (fail.bestEvSides || fail.graded) - fail.oddsCleared,
    );
    const missingOddsCount = rejectionDetail.odds_range?.missing_odds ?? 0;
    rejectionCounts.odds_range = missingOddsCount + oddsGate;
    rejectionDetail.odds_range = {
      missing_odds: missingOddsCount,
      props_only_odds_slack: oddsGate,
    };

    const sr = fail.stageRejects;
    if (sr) {
      for (const [reason, count] of Object.entries(sr.qualifyFail || {})) {
        const n = Number(count) || 0;
        const bucket =
          reason === "confidence_floor"
            ? "confidence"
            : reason === "grade_floor" || reason === "missing_score"
              ? "grade"
              : reason === "non_positive_edge"
                ? "edge"
                : reason === "sim_unsupported"
                  ? "unsupported_market"
                  : reason === "sim_invalid" || reason === "sim_not_above_implied"
                    ? "simulation_failure"
                    : reason === "non_positive_ev"
                      ? "odds_range"
                      : "confidence";
        for (let i = 0; i < n; i++) bumpDetail(bucket, reason);
      }
      const corrBits =
        (sr.ladderDedupe || 0) +
        (sr.perGameCap || 0) +
        (sr.marketSideCap || 0) +
        (sr.rareFamilyCap || 0) +
        (sr.rareFail || 0) +
        (sr.anytimeFail || 0);
      rejectionCounts.correlation = corrBits;
      rejectionDetail.correlation = {
        ladder_dedupe: sr.ladderDedupe || 0,
        per_game_cap: sr.perGameCap || 0,
        market_side_cap: sr.marketSideCap || 0,
        rare_family_cap: sr.rareFamilyCap || 0,
        rare_fail: sr.rareFail || 0,
        anytime_fail: sr.anytimeFail || 0,
      };
    }
  }

  console.error("[audit] buildCoachParlay E2E…");
  let coachResult = null;
  let coachError = null;
  try {
    coachResult = await buildCoachParlay({
      requestedLegs: TARGET,
      askText: ASK,
      signal: ac.signal,
      onStatus: (s) => {
        statuses.push(s);
        console.error("[coach]", s);
      },
    });
  } catch (e) {
    coachError = e instanceof Error ? e.message : String(e);
  }

  const builtPicks = built.picks ?? [];
  const coachPicks = coachResult?.picks ?? [];
  const coachSports = {};
  for (const p of coachPicks) bump(coachSports, sportOf(p) || "unknown");
  const nonNcaafCoach = coachPicks.filter((p) => !isNcaaf(sportOf(p)));

  const mainCand =
    builtPicks.find((p) => !p.propIsAlt && p.ticketRole !== "alt") ||
    candidates.find((p) => !p.propIsAlt) ||
    null;
  const altCand =
    builtPicks.find((p) => p.propIsAlt || p.ticketRole === "alt") ||
    candidates.find((p) => p.propIsAlt) ||
    allParsed.find((p) => p.propIsAlt && isNcaaf(sportOf(p))) ||
    null;

  function endToEndTrace(pick, role) {
    if (!pick) return null;
    const row = propsOnlyPoolRowForPick(pick, activePropPool);
    const key = propsOnlySimLookupKey(pick, row);
    const simHit = pick.finalAiScore?.simHit ?? pick.simHit ?? null;
    const inCandidates = candidates.some(
      (c) =>
        c.player === pick.player &&
        (c.propMarketKey ?? c.market) === (pick.propMarketKey ?? pick.market) &&
        c.propLine === pick.propLine &&
        c.propSide === pick.propSide,
    );
    const staged = builtPicks.some(
      (p) =>
        p.player === pick.player &&
        (p.propMarketKey ?? p.market) === (pick.propMarketKey ?? pick.market) &&
        p.propSide === pick.propSide,
    );
    const clearsOdds =
      simHit != null
        ? propsOnlyLegClearsOdds(pick, simHit, PROPS_ONLY_ODDS_SLACK)
        : null;
    const q = evaluateCoachQualification(
      {
        ...pick,
        isProp: true,
        propsOnlyTicket: true,
        simHit,
        edgePct: pick.finalAiScore?.edgePct ?? pick.edgePct ?? null,
        confidencePct:
          pick.finalAiScore?.confidencePct ?? pick.confidencePct ?? null,
        grade: pick.finalAiScore?.grade ?? pick.grade ?? null,
        odds: pick.odds,
        finalAiScore: pick.finalAiScore,
      },
      { requestStyle: "props_only", isProp: true },
    );
    return pickTrace(pick, {
      traceRole: role,
      lookupKey: key,
      poolRowFound: !!row,
      hitProbability: simHit,
      clearsOdds,
      qualifyStatus: q.status,
      qualifyReason: q.reason,
      staged,
      failDiagCode: fail?.code ?? null,
      stages: {
        inPool: !!row || inCandidates || staged,
        ncaaf: isNcaaf(sportOf(pick)),
        candidate: inCandidates || staged,
        historyLoaded: (fail?.historyLoaded ?? 0) > 0,
        graded: simHit != null || staged,
        oddsCleared: clearsOdds === true || staged,
        qualified: q.status === "qualified" || staged,
        staged,
      },
    });
  }

  const verdict = {
    pipelineDefect: null,
    legitimateNoQualifier: false,
    notes: [],
  };

  if (nonNcaafCandidates.length > 0) {
    verdict.pipelineDefect =
      "non_ncaaf_candidates_in_college_player_props_ask";
    verdict.notes.push(
      `${nonNcaafCandidates.length} non-NCAAF candidates reached props-only candidacy`,
    );
  }
  if (nonNcaafCoach.length > 0) {
    verdict.pipelineDefect =
      verdict.pipelineDefect || "non_ncaaf_legs_on_college_player_props_ticket";
    verdict.notes.push(`${nonNcaafCoach.length} non-NCAAF legs on Coach ticket`);
  }
  if (!askAllowsNcaafPlayerProps(ASK)) {
    verdict.pipelineDefect = "ask_gate_blocks_explicit_college_player_props";
  }
  if (
    !verdict.pipelineDefect &&
    builtPicks.length === 0 &&
    fail?.code
  ) {
    verdict.legitimateNoQualifier = true;
    verdict.notes.push(
      `Ticket empty under ${fail.code} with thresholds unchanged`,
    );
  }
  if (
    !verdict.pipelineDefect &&
    builtPicks.length > 0 &&
    builtPicks.length < TARGET
  ) {
    verdict.legitimateNoQualifier = true;
    verdict.notes.push(
      `Short ticket ${builtPicks.length}/${TARGET} — quality/diversity bar, not a gate unlock`,
    );
  }
  if (coachResult?.failDiag) {
    verdict.notes.push(
      `Coach E2E failDiag present: ${coachResult.failDiag.code}`,
    );
  } else if (built.failDiag && coachPicks.length < TARGET) {
    verdict.notes.push("Coach E2E missing failDiag (unexpected after fix)");
  }

  const report = {
    ask: ASK,
    target: TARGET,
    elapsedMs: Date.now() - t0,
    domain: process.env.EXPO_PUBLIC_DOMAIN,
    askAllowsNcaafPlayerProps: askAllowsNcaafPlayerProps(ASK),
    askIsCollegeFootballOnly: askIsCollegeFootballOnly(ASK),
    marketConstraint: {
      propsOnly: !!marketConstraint.propsOnly,
      gameLinesOnly: !!marketConstraint.gameLinesOnly,
      allowedMarketKeys: marketConstraint.allowedMarketKeys ?? null,
    },
    board: {
      sports: inputs.sports,
      oddsGames: inputs.oddsGames.length,
      espnGames: inputs.espnGames.length,
      rawPropPool: inputs.propPool.length,
      activePropPool: activePropPool.length,
      poolSports,
      stampDropsAtLoad: inputs.stampDrops,
      nonNcaafInActivePool: nonNcaafInPool.length,
      nonNcaafSample: nonNcaafInPool.slice(0, 5).map((e) => ({
        sport: e.sport,
        player: e.player,
        market: e.marketKey || e.market,
      })),
    },
    candidacy: {
      parsed: allParsed.length,
      missingOdds,
      unsupported,
      missingLine,
      missingAthlete,
      candidateOkBeforeCap: candOk,
      notSelectedByCap: notSelected,
      selectedCandidates: candidates.length,
      candidateSports,
      nonNcaafCandidates: nonNcaafCandidates.length,
      mainCount: candidates.filter((c) => !c.propIsAlt).length,
      altCount: candidates.filter((c) => c.propIsAlt).length,
    },
    grading: {
      historyLoaded: fail?.historyLoaded ?? 0,
      graded: fail?.graded ?? 0,
      nullReasons,
      bestEvSides: fail?.bestEvSides ?? 0,
      oddsCleared: fail?.oddsCleared ?? 0,
      staged: fail?.staged ?? 0,
    },
    ticketBuilder: {
      pickCount: builtPicks.length,
      propPoolSize: built.propPoolSize,
      propLegsScored: built.propLegsScored,
      note: built.note,
      failDiag: built.failDiag ?? null,
      picks: builtPicks.map((p) => pickTrace(p)),
    },
    coachE2E: {
      error: coachError,
      pickCount: coachPicks.length,
      propPoolSize: coachResult?.propPoolSize ?? null,
      note: coachResult?.note ?? null,
      failDiag: coachResult?.failDiag ?? null,
      failDiagPresent: coachResult?.failDiag != null,
      sports: coachSports,
      nonNcaafLegs: nonNcaafCoach.length,
      picks: coachPicks.map((p) => pickTrace(p)),
    },
    rejectionCounts,
    rejectionDetail,
    traces: {
      main: endToEndTrace(mainCand, "main"),
      alt: endToEndTrace(altCand, "alt"),
    },
    verdict,
    statuses,
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  const md = [
    `# NCAAF college player-props funnel audit`,
    ``,
    `Ask: \`${ASK}\` · target ${TARGET} · ${report.elapsedMs}ms`,
    ``,
    `## Rejection counts by reason`,
    ``,
    `| Reason | Count |`,
    `| --- | ---: |`,
    ...BUCKETS.map((k) => `| ${k} | ${rejectionCounts[k] ?? 0} |`),
    ``,
    `## NCAAF-only check`,
    ``,
    `- Active pool sports: \`${JSON.stringify(poolSports)}\``,
    `- Non-NCAAF in pool: ${nonNcaafInPool.length}`,
    `- Candidates sports: \`${JSON.stringify(candidateSports)}\``,
    `- Non-NCAAF candidates: ${nonNcaafCandidates.length}`,
    `- Coach ticket non-NCAAF legs: ${nonNcaafCoach.length}`,
    ``,
    `## Ticket`,
    ``,
    `- Props-only builder: ${builtPicks.length}/${TARGET} (failDiag=${built.failDiag?.code ?? "none"})`,
    `- Coach E2E: ${coachPicks.length}/${TARGET}${coachError ? ` error=${coachError}` : ""} (failDiag=${coachResult?.failDiag?.code ?? "none"})`,
    ``,
    `## Verdict`,
    ``,
    `- pipelineDefect: \`${verdict.pipelineDefect}\``,
    `- legitimateNoQualifier: ${verdict.legitimateNoQualifier}`,
    ...verdict.notes.map((n) => `- ${n}`),
    ``,
  ].join("\n");
  writeFileSync(OUT.replace(/\.json$/, ".md"), md);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} catch (e) {
  clearTimeout(hard);
  const err = {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : null,
    elapsedMs: Date.now() - t0,
    rejectionCounts,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(err, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  clearTimeout(hard);
}
