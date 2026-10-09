/**
 * Exact phone repro: "8 leg NFL" with full TB@DAL prop/milestone inventory
 * and per-candidate rejection reasons for seats 6–8.
 *
 * EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   node --import ./test/register-hooks.mjs scripts/phone8legNflTrace.mjs
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const u = (rel) => pathToFileURL(path.join(root, rel)).href;

const { buildCoachParlay } = await import(u("lib/coach/buildParlay.ts"));
const { parseRequestedLegs } = await import(u("lib/coach/parseAsk.ts"));
const { parseMarketPeriod } = await import(u("lib/simMarketSupport.ts"));
const { isPostedMilestoneAltLine } = await import(u("lib/coachMilestoneLines.ts"));
const { marketLadderKey, wouldRepeatMarketLadder } = await import(
  u("lib/marketLadderKey.ts")
);
const {
  wouldRepeatPlayerProp,
  wouldExceedMaxPropsPerGame,
  wouldExceedMaxLegsPerGame,
  maxPropsPerGame,
  maxLegsPerGame,
  progressiveLegsPerGameRelaxation,
} = await import(u("lib/parlayCorrelationScore.ts"));
const { boardLegPoolRole, topUpTicketFromQualifiedScored } = await import(
  u("lib/ticketStaging.ts")
);
const { enforceMlLeanOnPicks } = await import(u("lib/mlLeanEnforcement.ts"));
const { topUpAfterMlLean, isPostLeanFillBlockedPeriodMarket } = await import(
  u("lib/postLeanFinalFill.ts")
);

const ASK = "8 leg NFL";
const target = parseRequestedLegs(ASK) || 8;
const OUT = process.env.PHONE_8LEG_OUT || "/tmp/coach-probes/phone-8leg-nfl-trace.json";
const GAME_RE = /buccaneers|cowboys|tampa|dallas/i;

console.log("[phone8] domain=", process.env.EXPO_PUBLIC_DOMAIN, "ask=", ASK);
const t0 = Date.now();
const result = await buildCoachParlay({
  askText: ASK,
  requestedLegs: target,
  signal: AbortSignal.timeout(300_000),
  onStatus: (s) => console.log(`[status +${Math.round((Date.now() - t0) / 1000)}s] ${s}`),
});

const picks = result.picks ?? [];
const pool = result.scan?.qualifiedCandidates ?? [];
const allScored = result.scan?.scoredCandidates ?? result.scan?.allScored ?? [];
const maxProps = maxPropsPerGame(target);
const maxLegs = maxLegsPerGame(target);
const relax = progressiveLegsPerGameRelaxation(target, null, {});

function isTbDal(p) {
  return GAME_RE.test(String(p.game ?? ""));
}

function classify(cand, ticket, legsCap) {
  const reasons = [];
  if (boardLegPoolRole(cand, cand.finalAiScore) == null) {
    reasons.push("qualification_failure");
  }
  if (wouldRepeatMarketLadder(cand, ticket)) reasons.push("same_player_ladder_or_market_ladder");
  if (wouldRepeatPlayerProp(cand, ticket)) reasons.push("same_player_prop_correlation");
  if (wouldExceedMaxPropsPerGame(cand, ticket, maxProps)) reasons.push("max_props_per_game");
  if (wouldExceedMaxLegsPerGame(cand, ticket, legsCap)) reasons.push("game_line_cap_max_legs_per_game");
  if (cand.isProp && (cand.finalAiScore?.simHit == null && cand.simHit == null)) {
    // may still be graded via other path
  }
  if (!reasons.length) reasons.push("outranked_or_staging_order");
  return reasons;
}

const ticket = picks.map((p) => ({
  game: p.game,
  market: p.market,
  pick: p.pick,
  odds: p.odds,
  isProp: !!p.isProp,
  player: p.player ?? null,
  propLine: p.propLine ?? null,
  propIsAlt: !!p.propIsAlt,
  propMarketKey: p.propMarketKey ?? null,
  period: parseMarketPeriod(p.market ?? ""),
  grade: p.finalAiScore?.grade ?? null,
  simHit: p.finalAiScore?.simHit ?? null,
  milestone: p.isProp
    ? isPostedMilestoneAltLine(p.propLine, p.propMarketKey ?? p.market, null)
    : false,
  ladder: marketLadderKey(p),
}));

const gamesOnTicket = [...new Set(picks.map((p) => p.game))];
const nflGamesInPool = [
  ...new Set(pool.filter((p) => String(p.sport ?? "").toLowerCase() === "nfl").map((p) => p.game)),
];

// TB@DAL props from qualified pool + any scan diagnostics
const tbDalProps = pool.filter((p) => p.isProp && isTbDal(p));
const tbDalAll = pool.filter((p) => isTbDal(p));

const propInventory = tbDalProps.map((p) => {
  const reasons = classify(p, picks, maxLegs);
  const onTicket = picks.some(
    (t) => t.game === p.game && t.market === p.market && t.pick === p.pick,
  );
  return {
    player: p.player ?? null,
    market: p.market,
    propMarketKey: p.propMarketKey ?? null,
    pick: p.pick,
    propLine: p.propLine ?? null,
    propSide: p.propSide ?? null,
    propIsAlt: !!p.propIsAlt,
    odds: p.odds,
    milestone: isPostedMilestoneAltLine(p.propLine, p.propMarketKey ?? p.market, null),
    simHit: p.finalAiScore?.simHit ?? null,
    grade: p.finalAiScore?.grade ?? null,
    composite: p.finalAiScore?.composite ?? null,
    poolRole: boardLegPoolRole(p, p.finalAiScore),
    ladder: marketLadderKey(p),
    onTicket,
    rejectionIfNotSeated: onTicket ? null : reasons[0],
    allRejectionReasons: onTicket ? [] : reasons,
  };
});

// Try seating additional independent props under SAME caps (no raise)
const propLeftovers = pool
  .filter((p) => p.isProp)
  .map((p) => ({
    pick: p,
    evPct: p.finalAiScore?.edgePct ?? 0,
    edgePct: p.finalAiScore?.edgePct ?? 0,
    confidencePct: p.finalAiScore?.confidencePct ?? 0,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: p.finalAiScore?.grade ?? "B",
    simHit: p.finalAiScore?.simHit ?? null,
    composite: p.finalAiScore?.composite ?? 0,
    rankScore: (p.finalAiScore?.composite ?? 0) * 10 + (p.finalAiScore?.simHit ?? 0),
  }));

const afterPropExhaust = topUpTicketFromQualifiedScored(
  picks,
  propLeftovers,
  target,
  "phone-8leg",
  maxLegs,
);

// Also try with progressive GL relax only (existing safety path)
let relaxed = picks.slice();
for (const raised of relax) {
  const next = topUpTicketFromQualifiedScored(
    relaxed,
    pool.map((p) => ({
      pick: p,
      evPct: 0,
      edgePct: p.finalAiScore?.edgePct ?? 0,
      confidencePct: p.finalAiScore?.confidencePct ?? 0,
      impliedProbPct: 50,
      lineShoppingScore: 1,
      grade: p.finalAiScore?.grade ?? "B",
      simHit: p.finalAiScore?.simHit ?? null,
      composite: p.finalAiScore?.composite ?? 0,
      rankScore: (p.finalAiScore?.composite ?? 0) * 10,
    })),
    target,
    "phone-8leg-relax",
    raised,
  );
  if (next.length > relaxed.length) relaxed = next;
  if (relaxed.length >= target) break;
}

// Classify what blocks going from 5 → 8: greedy walk
const blockersForNextSeats = [];
let simTicket = picks.slice();
for (let seat = picks.length + 1; seat <= target; seat++) {
  const candidates = [];
  for (const cand of pool) {
    const reasons = classify(cand, simTicket, maxLegs);
    const relaxedReasons = classify(cand, simTicket, relax[relax.length - 1] ?? maxLegs);
    candidates.push({
      pick: cand.pick,
      market: cand.market,
      game: cand.game,
      isProp: !!cand.isProp,
      player: cand.player ?? null,
      propLine: cand.propLine ?? null,
      milestone: cand.isProp
        ? isPostedMilestoneAltLine(cand.propLine, cand.propMarketKey ?? cand.market, null)
        : false,
      grade: cand.finalAiScore?.grade ?? null,
      simHit: cand.finalAiScore?.simHit ?? null,
      reasonsAtDefaultCap: reasons,
      reasonsAtMaxRelax: relaxedReasons,
      clearAtDefault: reasons[0] === "outranked_or_staging_order",
      clearAtMaxRelax: relaxedReasons[0] === "outranked_or_staging_order",
    });
  }
  const clearDefault = candidates.filter((c) => c.clearAtDefault);
  const clearRelax = candidates.filter((c) => c.clearAtMaxRelax);
  const propClearDefault = clearDefault.filter((c) => c.isProp);
  const propClearRelax = clearRelax.filter((c) => c.isProp);
  blockersForNextSeats.push({
    seat,
    clearAtDefaultCap: clearDefault.length,
    clearPropsAtDefaultCap: propClearDefault.length,
    clearAtMaxRelax: clearRelax.length,
    clearPropsAtMaxRelax: propClearRelax.length,
    sampleClearProps: propClearRelax.slice(0, 8).map((c) => ({
      player: c.player,
      pick: c.pick,
      market: c.market,
      line: c.propLine,
      milestone: c.milestone,
      grade: c.grade,
    })),
    dominantBlockOnProps: (() => {
      const props = candidates.filter((c) => c.isProp && !c.clearAtMaxRelax);
      const counts = {};
      for (const p of props) {
        const r = p.reasonsAtMaxRelax[0];
        counts[r] = (counts[r] ?? 0) + 1;
      }
      return counts;
    })(),
  });
  // Seat best clear candidate if any (for walking further) — prefer props
  const next =
    propClearRelax[0] ||
    clearRelax[0] ||
    null;
  if (!next) break;
  const full = pool.find(
    (p) => p.game === next.game && p.market === next.market && p.pick === next.pick,
  );
  if (!full) break;
  simTicket = [...simTicket, full];
}

const summary = {
  ask: ASK,
  target,
  elapsedMs: Date.now() - t0,
  domain: process.env.EXPO_PUBLIC_DOMAIN,
  caps: {
    maxPropsPerGame: maxProps,
    maxLegsPerGame: maxLegs,
    progressiveRelaxation: relax,
  },
  finalCount: picks.length,
  propsOnTicket: picks.filter((p) => p.isProp).length,
  gamesOnTicket,
  nflGamesInQualifiedPool: nflGamesInPool,
  notePreview: String(result.note ?? "").slice(0, 500),
  ticket,
  poolSizes: {
    qualified: pool.length,
    props: pool.filter((p) => p.isProp).length,
    tbDalQualified: tbDalAll.length,
    tbDalProps: tbDalProps.length,
    tbDalMilestones: propInventory.filter((p) => p.milestone).length,
    tbDalAltProps: propInventory.filter((p) => p.propIsAlt).length,
    periodBlocked: pool.filter((p) => isPostLeanFillBlockedPeriodMarket(p)).length,
    fgAlts: pool.filter(
      (p) =>
        !p.isProp &&
        parseMarketPeriod(p.market ?? "") === "fg" &&
        /\balt\b/i.test(p.market ?? ""),
    ).length,
  },
  tbDalPropInventory: propInventory.sort((a, b) => {
    if (a.onTicket !== b.onTicket) return a.onTicket ? -1 : 1;
    return String(a.player).localeCompare(String(b.player));
  }),
  propRejectCounts: propInventory
    .filter((p) => !p.onTicket)
    .reduce((acc, p) => {
      const k = p.rejectionIfNotSeated ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  afterPropExhaustOnly: {
    count: afterPropExhaust.length,
    added: afterPropExhaust
      .filter(
        (p) => !picks.some((t) => t.game === p.game && t.market === p.market && t.pick === p.pick),
      )
      .map((p) => ({ market: p.market, pick: p.pick, isProp: p.isProp, odds: p.odds })),
  },
  afterProgressiveRelax: {
    count: relaxed.length,
    added: relaxed
      .filter(
        (p) => !picks.some((t) => t.game === p.game && t.market === p.market && t.pick === p.pick),
      )
      .map((p) => ({ market: p.market, pick: p.pick, isProp: p.isProp, odds: p.odds })),
  },
  blockersForNextSeats,
  scanManifest: result.scan?.manifest ?? result.manifest ?? null,
};

writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      finalCount: summary.finalCount,
      propsOnTicket: summary.propsOnTicket,
      gamesOnTicket: summary.gamesOnTicket,
      nflGamesInPool: summary.nflGamesInQualifiedPool,
      poolSizes: summary.poolSizes,
      propRejectCounts: summary.propRejectCounts,
      afterPropExhaust: summary.afterPropExhaustOnly,
      afterRelax: summary.afterProgressiveRelax,
      blockers: summary.blockersForNextSeats,
      caps: summary.caps,
    },
    null,
    2,
  ),
);
console.log("[phone8] wrote", OUT);
