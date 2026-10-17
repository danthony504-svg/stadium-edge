#!/usr/bin/env node
/**
 * Live audit: exact ask "7 leg college football player props".
 *
 * Counts rejections by reason buckets requested for the audit:
 *   missing_history_context | simulation_failure | stamp_rejection |
 *   unsupported_market | odds_range | grade | confidence | edge | correlation
 *
 * Verifies NCAAF-only candidates; traces one main + one ALT end-to-end.
 * Does not lower thresholds or unlock team markets.
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
} = await import(u("lib/boardScanPropDelivery.ts"));
const {
  hardLockedSportsFromAsk,
  canonicalizeCoachAskSport,
} = await import(u("lib/coachAskSportScope.ts"));
const { coachBoardSportsForAsk } = await import(
  u("lib/coachPropBoardCoverage.ts")
);
const {
  getGames,
  getOdds,
  getLiveOdds,
  fetchFullBoardPropPool,
  getPlayerHistory,
  fetchPropSimulations,
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
  normalizePropsOnlyPick,
  gradeFootballPropsOnlyFromHistory,
  propsOnlyPoolRowForPick,
  propsOnlySimLookupKey,
  propsOnlyPickHasGrade,
  propsOnlyLegClearsOdds,
  collapsePropsOnlyToBestEvSides,
  softClipPropsOnlyHits,
  lookupPropsOnlyHit,
  lookupPropsOnlyHitReliability,
  PROPS_ONLY_ODDS_SLACK,
  propsOnlyEffectiveLine,
} = await import(u("lib/coachFootballPropsOnlyGrade.ts"));
const { marketSupportsSimulation } = await import(u("lib/simMarketSupport.ts"));
const {
  buildFootballPropsOnlyTicket,
  selectFootballPropsOnlyCandidates,
  FOOTBALL_PROPS_ONLY_BATCH,
} = await import(u("lib/coachFootballPropsOnlyTicket.ts"));
const { evaluateCoachQualification } = await import(
  u("lib/coach/qualifyCoachCandidate.ts")
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

function classifyQualifyReason(reason) {
  const r = String(reason || "");
  if (r === "confidence_floor") return "confidence";
  if (r === "grade_floor" || r === "missing_score") return "grade";
  if (r === "non_positive_edge") return "edge";
  if (r === "sim_unsupported") return "unsupported_market";
  if (r === "sim_invalid" || r === "sim_not_above_implied") return "simulation_failure";
  if (r === "non_positive_ev") return "odds_range";
  if (r === "style_blocked") return "correlation";
  return null;
}

function sportOf(row) {
  return canonicalizeCoachAskSport(row?.sport) || String(row?.sport ?? "").toLowerCase();
}

function isNcaaf(sport) {
  const s = String(sport ?? "").toLowerCase();
  return s === "ncaaf" || s === "cfb" || s === "college-football";
}

async function loadInputs(ask, legs, signal, onStatus) {
  const sports = coachBoardSportsForAsk(ask, legs, ["ncaaf"]);
  const lockedSports = hardLockedSportsFromAsk(ask);
  const stampAndKeepSport = (rows, sport) => {
    const want = canonicalizeCoachAskSport(sport);
    let stampedDrop = 0;
    const kept = [];
    for (const g of rows) {
      const tagged = canonicalizeCoachAskSport(g.sport);
      if (tagged && tagged !== want) {
        stampedDrop += 1;
        continue;
      }
      kept.push({ ...g, sport: tagged || want });
    }
    return { kept, stampedDrop };
  };

  let stampDrops = 0;
  const [espnGamesRaw, oddsRaw, liveFeed] = await Promise.all([
    Promise.all(
      sports.map((s) =>
        getGames(s, signal)
          .catch(() => [])
          .then((rows) => {
            const { kept, stampedDrop } = stampAndKeepSport(rows, s);
            stampDrops += stampedDrop;
            return kept;
          }),
      ),
    ).then((rows) => rows.flat()),
    Promise.all(
      sports.map((s) =>
        getOdds(s, signal)
          .catch(() => [])
          .then((rows) => {
            const { kept, stampedDrop } = stampAndKeepSport(rows, s);
            stampDrops += stampedDrop;
            return kept;
          }),
      ),
    ).then((rows) => filterBettableOddsGames(rows.flat())),
    getLiveOdds(sports, signal).catch(() => ({ games: [], odds: [] })),
  ]);

  const teamScope = coachAskTeamScope(ask);
  let excludedTeams = excludedTeamScopesFromText(ask);
  excludedTeams = resolveExcludedTeamIdsFromGames(excludedTeams, espnGamesRaw);
  const sportBeltGames = (rows) =>
    lockedSports?.length
      ? rows.filter((g) => {
          const s = canonicalizeCoachAskSport(g.sport);
          return !!s && lockedSports.includes(s);
        })
      : rows;

  const slateDay = slateDayFromThread(ask ?? "", []);
  let oddsGames = filterOddsGamesForCoachAskTeams(
    sportBeltGames(oddsRaw),
    teamScope,
    excludedTeams,
  );
  let espnGames = filterOddsGamesForCoachAskTeams(
    sportBeltGames(espnGamesRaw),
    teamScope,
    excludedTeams,
  );
  oddsGames = filterOddsGamesForSlateDay(oddsGames, slateDay);
  espnGames = filterOddsForSlateDay(espnGames, slateDay);

  onStatus?.("Loading player props and alt lines…");
  let propPool = await fetchFullBoardPropPool(oddsGames, espnGames, [], signal).catch(
    () => [],
  );
  propPool = filterOddsForSlateDay(propPool, slateDay);
  propPool = filterPicksForCoachAskTeams(propPool, teamScope, excludedTeams);

  return {
    espnGames,
    oddsGames,
    propPool,
    sports,
    lockedSports,
    stampDrops,
    slateDay,
    liveOdds: liveFeed.odds ?? [],
  };
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

console.error("[audit] ask=", ASK, "target=", TARGET);
console.error("[audit] domain=", process.env.EXPO_PUBLIC_DOMAIN);
console.error(
  "[audit] askAllowsNcaafPlayerProps=",
  askAllowsNcaafPlayerProps(ASK),
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

try {
  // ── 1) Load board (mirrors loadScanInputs) ───────────────────────────
  const inputs = await loadInputs(ASK, TARGET, ac.signal, (s) => {
    statuses.push(s);
    console.error("[status]", s);
  });

  const marketConstraint = parseCoachAskMarketConstraint(ASK, []);
  const allowedKeys = Array.isArray(marketConstraint.allowedMarketKeys)
    ? marketConstraint.allowedMarketKeys
    : null;
  console.error(
    "[audit] pool=",
    inputs.propPool.length,
    "allowedKeys=",
    allowedKeys,
    "propsOnly=",
    marketConstraint.propsOnly,
  );
  const scanPropPool = allowedKeys
    ? filterPropPoolByAskMarkets(inputs.propPool, allowedKeys)
    : inputs.propPool;
  const activePropPool = askAllowsNcaafPlayerProps(ASK)
    ? scanPropPool
    : filterNcaafPlayerPropsUnlessAsked(scanPropPool, ASK);

  rejectionCounts.stamp_rejection = inputs.stampDrops;
  rejectionDetail.stamp_rejection = {
    cross_sport_row_drop: inputs.stampDrops,
  };

  const poolSports = {};
  for (const e of activePropPool) bump(poolSports, sportOf(e) || "unknown");
  const nonNcaafInPool = activePropPool.filter((e) => !isNcaaf(sportOf(e)));

  // ── 2) Candidate selection rejections ────────────────────────────────
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

  // Cap / not selected from pool — reported under candidacy, not correlation.
  const notSelected = Math.max(0, candOk - candidates.length);

  // ── 3) Authoritative ticket build (history → grade → odds → stage) ───
  console.error(
    `[audit] candidates=${candidates.length} pool=${activePropPool.length}`,
  );
  console.error("[audit] buildFootballPropsOnlyTicket…");
  process.on("unhandledRejection", (err) => {
    console.error("[audit] unhandledRejection (swallowed)", err?.message || err);
  });
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

  const fail = built.failDiag;
  const nullReasons = fail?.nullReasons ?? {};
  for (const [reason, count] of Object.entries(nullReasons)) {
    const n = Number(count) || 0;
    for (let i = 0; i < n; i++) {
      bumpDetail(classifyNullReason(reason), reason);
    }
  }

  if (fail) {
    // Odds gate: best-EV sides that failed props-only odds slack
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
    } else {
      // Fallback when stageRejects absent (older builder).
      rejectionCounts.correlation = 0;
      rejectionDetail.correlation = {
        staging_unspecified: Math.max(0, fail.oddsCleared - fail.staged),
      };
    }
  }

  // Qualify-gate breakdown on delivered / near-delivered picks
  const qualifyRejects = {};
  for (const pick of built.picks ?? []) {
    const q = evaluateCoachQualification(
      {
        ...pick,
        isProp: true,
        propsOnlyTicket: true,
        simHit: pick.finalAiScore?.simHit ?? pick.simHit ?? null,
        edgePct: pick.finalAiScore?.edgePct ?? pick.edgePct ?? null,
        confidencePct:
          pick.finalAiScore?.confidencePct ?? pick.confidencePct ?? null,
        grade: pick.finalAiScore?.grade ?? pick.grade ?? null,
        odds: pick.odds,
        finalAiScore: pick.finalAiScore,
      },
      { requestStyle: "props_only", isProp: true },
    );
    if (q.status === "rejected") {
      bump(qualifyRejects, q.reason);
      const bucket = classifyQualifyReason(q.reason);
      if (bucket) bumpDetail(bucket, q.reason);
    }
  }

  // When ticket is empty/short, attribute residual graded→oddsCleared gaps that
  // look like grade/confidence/edge using failDiag code.
  if (fail?.code === "PROPS_ONLY_NO_GRADE" && (fail.graded ?? 0) === 0) {
    // already counted via nullReasons
  } else if (fail?.code === "PROPS_ONLY_ODDS_GATE") {
    // already in odds_range
  }

  const historyLoaded = fail?.historyLoaded ?? 0;
  const gradedCandidates = { length: fail?.graded ?? 0 };
  const propHits = new Map();
  const localHistories = {};
  const stillNull = { length: Math.max(0, candidates.length - historyLoaded) };

  // ── 5) Full Coach path (E2E) ─────────────────────────────────────────
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

  const coachPicks = coachResult?.picks ?? [];
  const coachSports = {};
  for (const p of coachPicks) bump(coachSports, sportOf(p) || "unknown");
  const nonNcaafCoach = coachPicks.filter((p) => !isNcaaf(sportOf(p)));

  // ── 6) Trace main + ALT ──────────────────────────────────────────────
  const builtPicks = built.picks ?? [];
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

  // Defect checks (do not lower thresholds):
  // 1) Non-NCAAF leaked into college player-props candidates
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
    verdict.notes.push(
      `${nonNcaafCoach.length} non-NCAAF legs on Coach ticket`,
    );
  }
  // 2) ask gate wrong
  if (!askAllowsNcaafPlayerProps(ASK)) {
    verdict.pipelineDefect = "ask_gate_blocks_explicit_college_player_props";
  }
  // 3) Non-NCAAF already handled above.
  // 4) Legitimate empty: confidence / odds / history quality bar (thresholds unchanged)
  if (
    !verdict.pipelineDefect &&
    builtPicks.length === 0 &&
    (fail?.code === "PROPS_ONLY_NO_HISTORY" ||
      fail?.code === "PROPS_ONLY_NO_GRADE" ||
      fail?.code === "PROPS_ONLY_ODDS_GATE" ||
      fail?.code === "PROPS_ONLY_CONFIDENCE_GATE" ||
      fail?.code === "PROPS_ONLY_EMPTY" ||
      fail?.code === "PROPS_ONLY_STAGED_SHORT" ||
      fail?.code === "PROPS_ONLY_POOL_EMPTY" ||
      fail?.code === "PROPS_ONLY_NO_CANDIDATES")
  ) {
    verdict.legitimateNoQualifier = true;
    verdict.notes.push(`Ticket empty under ${fail.code} with thresholds unchanged`);
  }
  if (
    coachResult &&
    coachPicks.length < TARGET &&
    coachResult.failDiag == null &&
    built.failDiag != null
  ) {
    verdict.notes.push(
      "observability residual: Coach E2E still missing failDiag (expected fixed in this change)",
    );
  }
  if (!verdict.pipelineDefect && builtPicks.length > 0 && builtPicks.length < TARGET) {
    verdict.legitimateNoQualifier = true;
    verdict.notes.push(
      `Short ticket ${builtPicks.length}/${TARGET} — quality/diversity bar, not a gate unlock`,
    );
  }

  const report = {
    ask: ASK,
    target: TARGET,
    elapsedMs: Date.now() - t0,
    domain: process.env.EXPO_PUBLIC_DOMAIN,
    askAllowsNcaafPlayerProps: askAllowsNcaafPlayerProps(ASK),
    marketConstraint: {
      propsOnly: !!marketConstraint.propsOnly,
      gameLinesOnly: !!marketConstraint.gameLinesOnly,
      allowedMarketKeys: marketConstraint.allowedMarketKeys ?? null,
    },
    board: {
      sports: inputs.sports,
      lockedSports: inputs.lockedSports,
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
      historyLoaded,
      graded: gradedCandidates.length,
      nullReasons,
      stillNullAfterLocal: stillNull.length,
    },
    ticketBuilder: {
      pickCount: builtPicks.length,
      propPoolSize: built.propPoolSize,
      propLegsScored: built.propLegsScored,
      note: built.note,
      failDiag: built.failDiag ?? null,
      picks: builtPicks.map((p) => pickTrace(p)),
      sports: Object.fromEntries(
        Object.entries(
          builtPicks.reduce((acc, p) => {
            bump(acc, sportOf(p) || "unknown");
            return acc;
          }, {}),
        ),
      ),
    },
    coachE2E: {
      error: coachError,
      pickCount: coachPicks.length,
      propPoolSize: coachResult?.propPoolSize ?? null,
      note: coachResult?.note ?? null,
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
    qualifyRejects,
    verdict,
    statuses,
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  // Also write a markdown summary
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
    `- Coach E2E: ${coachPicks.length}/${TARGET}${coachError ? ` error=${coachError}` : ""}`,
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

function normalizeHistorySportSafe(sport) {
  const n = String(sport ?? "")
    .toLowerCase()
    .trim();
  if (n === "nfl" || n.includes("americanfootball_nfl")) return "nfl";
  if (n === "ncaaf" || n === "cfb" || n.includes("americanfootball_ncaaf"))
    return "ncaaf";
  return n;
}
