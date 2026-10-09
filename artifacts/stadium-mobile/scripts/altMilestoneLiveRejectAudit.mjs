/**
 * Live Coach probe + rejection audit for alt/+ milestone release verification.
 * Classifies why qualified pool legs did not land on the final ticket.
 *
 * Run: EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   SLICE_A_ASK="7 leg NFL" SLICE_A_OUT=/tmp/coach-probes/reject-audit.json \
 *   node --import ./test/register-hooks.mjs scripts/altMilestoneLiveRejectAudit.mjs
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
} = await import(u("lib/parlayCorrelationScore.ts"));
const { boardLegPoolRole } = await import(u("lib/ticketStaging.ts"));

const ASK = process.env.SLICE_A_ASK || "7 leg NFL";
const OUT = process.env.SLICE_A_OUT || "/tmp/coach-probes/reject-audit.json";
const target = parseRequestedLegs(ASK) || 7;

console.log("[reject-audit] domain=", process.env.EXPO_PUBLIC_DOMAIN, "ask=", ASK);
const t0 = Date.now();
const result = await buildCoachParlay({
  askText: ASK,
  requestedLegs: target,
  signal: AbortSignal.timeout(240_000),
  onStatus: (s) => console.log(`[status +${Math.round((Date.now() - t0) / 1000)}s] ${s}`),
});

const picks = result.picks ?? [];
const pool = result.scan?.qualifiedCandidates ?? [];
const maxProps = maxPropsPerGame(target);
const maxLegs = maxLegsPerGame(target);

function classifyReject(cand, ticket) {
  const reasons = [];
  if (boardLegPoolRole(cand, cand.finalAiScore) == null) reasons.push("not_pool_qualified");
  if (wouldRepeatMarketLadder(cand, ticket)) reasons.push("duplicate_market_ladder");
  if (wouldRepeatPlayerProp(cand, ticket)) reasons.push("duplicate_player_prop");
  if (wouldExceedMaxPropsPerGame(cand, ticket, maxProps)) reasons.push("max_props_per_game");
  if (wouldExceedMaxLegsPerGame(cand, ticket, maxLegs)) reasons.push("max_legs_per_game");
  if (!reasons.length) reasons.push("outranked_or_other_staging_gate");
  return reasons;
}

const ticketFps = new Set(
  picks.map((p) => `${p.game}|${p.market}|${p.pick}`),
);
const onTicket = picks.map((p) => ({
  game: p.game,
  market: p.market,
  pick: p.pick,
  odds: p.odds,
  isProp: !!p.isProp,
  propLine: p.propLine,
  propIsAlt: !!p.propIsAlt,
  period: parseMarketPeriod(p.market ?? ""),
  grade: p.finalAiScore?.grade ?? null,
  simHit: p.finalAiScore?.simHit ?? null,
  milestone: p.isProp
    ? isPostedMilestoneAltLine(p.propLine, p.propMarketKey ?? p.market, null)
    : false,
}));

const props = pool.filter((p) => p.isProp);
const milestones = props.filter((p) =>
  isPostedMilestoneAltLine(p.propLine, p.propMarketKey ?? p.market, null),
);
const fgAlts = pool.filter(
  (p) => !p.isProp && parseMarketPeriod(p.market ?? "") === "fg" && /\balt\b/i.test(p.market ?? ""),
);

const rejected = [];
for (const cand of pool) {
  const fp = `${cand.game}|${cand.market}|${cand.pick}`;
  if (ticketFps.has(fp)) continue;
  const reasons = classifyReject(cand, picks);
  rejected.push({
    game: cand.game,
    market: cand.market,
    pick: cand.pick,
    isProp: !!cand.isProp,
    propLine: cand.propLine ?? null,
    propIsAlt: !!cand.propIsAlt,
    milestone: cand.isProp
      ? isPostedMilestoneAltLine(cand.propLine, cand.propMarketKey ?? cand.market, null)
      : false,
    period: parseMarketPeriod(cand.market ?? ""),
    grade: cand.finalAiScore?.grade ?? null,
    simHit: cand.finalAiScore?.simHit ?? null,
    primaryReason: reasons[0],
    reasons,
  });
}

const reasonCounts = {};
for (const r of rejected) {
  reasonCounts[r.primaryReason] = (reasonCounts[r.primaryReason] ?? 0) + 1;
}
const propRejectReasons = {};
for (const r of rejected.filter((x) => x.isProp)) {
  propRejectReasons[r.primaryReason] = (propRejectReasons[r.primaryReason] ?? 0) + 1;
}

const bySport = {};
for (const p of pool) {
  const s = String(p.sport ?? "unknown").toLowerCase();
  if (!bySport[s]) {
    bySport[s] = {
      availableQualified: 0,
      props: 0,
      milestones: 0,
      simulatedGradeable: 0,
      onTicket: 0,
      onTicketProps: 0,
    };
  }
  bySport[s].availableQualified += 1;
  if (p.isProp) bySport[s].props += 1;
  if (
    p.isProp &&
    isPostedMilestoneAltLine(p.propLine, p.propMarketKey ?? p.market, null)
  ) {
    bySport[s].milestones += 1;
  }
  if (p.finalAiScore?.simHit != null) bySport[s].simulatedGradeable += 1;
}
for (const p of picks) {
  const s = String(p.sport ?? "unknown").toLowerCase();
  if (!bySport[s]) continue;
  bySport[s].onTicket += 1;
  if (p.isProp) bySport[s].onTicketProps += 1;
}

const gamesOnTicket = new Set(picks.map((p) => p.game));
const summary = {
  ask: ASK,
  target,
  elapsedMs: Date.now() - t0,
  caps: { maxPropsPerGame: maxProps, maxLegsPerGame: maxLegs },
  finalCount: picks.length,
  propsOnTicket: picks.filter((p) => p.isProp).length,
  milestonesOnTicket: onTicket.filter((p) => p.milestone).length,
  fgAltOnTicket: onTicket.filter((p) => !p.isProp && p.period === "fg" && /\balt\b/i.test(p.market)).length,
  periodOnTicket: onTicket.filter((p) => p.period !== "fg" && !p.isProp).length,
  gamesOnTicket: [...gamesOnTicket],
  pool: {
    qualified: pool.length,
    props: props.length,
    milestones: milestones.length,
    fgAlts: fgAlts.length,
  },
  bySport,
  ticket: onTicket,
  rejectionReasonCounts: reasonCounts,
  propRejectionReasonCounts: propRejectReasons,
  rejectedProps: rejected.filter((r) => r.isProp).slice(0, 40),
  rejectedMilestones: rejected.filter((r) => r.milestone).slice(0, 40),
  notePreview: String(result.note ?? "").slice(0, 400),
};

writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  finalCount: summary.finalCount,
  propsOnTicket: summary.propsOnTicket,
  milestonesOnTicket: summary.milestonesOnTicket,
  fgAltOnTicket: summary.fgAltOnTicket,
  gamesOnTicket: summary.gamesOnTicket.length,
  pool: summary.pool,
  propRejectionReasonCounts: summary.propRejectionReasonCounts,
  caps: summary.caps,
}, null, 2));
console.log("[reject-audit] wrote", OUT);
