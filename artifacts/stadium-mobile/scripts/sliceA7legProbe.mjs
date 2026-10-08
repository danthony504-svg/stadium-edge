/**
 * Slice A live probe: 7 leg NFL via buildCoachParlay (real odds).
 * Confirms final count, shortfall copy, and no period markets among
 * fill-eligible classification on the delivered ticket extras.
 *
 * Run: EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   node --import ./test/register-hooks.mjs scripts/sliceA7legProbe.mjs
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const u = (rel) => pathToFileURL(path.join(root, rel)).href;

const { buildCoachParlay } = await import(u("lib/coach/buildParlay.ts"));
const { parseRequestedLegs } = await import(u("lib/coach/parseAsk.ts"));
const { parseMarketPeriod } = await import(u("lib/simMarketSupport.ts"));
const { topUpAfterMlLean, isPostLeanFillBlockedPeriodMarket } = await import(
  u("lib/postLeanFinalFill.ts")
);
const { enforceMlLeanOnPicks } = await import(u("lib/mlLeanEnforcement.ts"));

const ASK = process.env.SLICE_A_ASK || "7 leg NFL";
const OUT = process.env.SLICE_A_OUT || "/tmp/slice-a-7leg-probe.json";

function isPeriodMarket(p) {
  if (p?.isProp) return false;
  const period = parseMarketPeriod(p?.market ?? "");
  return period !== "fg";
}

console.log("[sliceA] domain=", process.env.EXPO_PUBLIC_DOMAIN);
console.log("[sliceA] ask=", ASK);
const t0 = Date.now();
const result = await buildCoachParlay({
  askText: ASK,
  requestedLegs: parseRequestedLegs(ASK) || 7,
  signal: AbortSignal.timeout(240_000),
  onStatus: (s) => console.log(`[status +${Math.round((Date.now() - t0) / 1000)}s] ${s}`),
});

const picks = result.picks ?? [];
const target = parseRequestedLegs(ASK) || 7;
const qualifiedPool = [
  ...(result.scan?.qualifiedCandidates ?? []),
];
const periodOnTicket = picks.filter(isPeriodMarket);
const periodBlockedInPool = qualifiedPool.filter((p) =>
  isPostLeanFillBlockedPeriodMarket(p),
).length;
const fgAltPool = qualifiedPool.filter(
  (p) => !p.isProp && !isPostLeanFillBlockedPeriodMarket(p) && /\balt\b/i.test(p.market ?? ""),
).length;
const propPool = qualifiedPool.filter((p) => p.isProp).length;

// Synthetic lean→fill on the live qualified pool (if ticket already full, still
// exercise fill growth from a forced short baseline of first 4).
let synthetic = null;
if (qualifiedPool.length >= 4) {
  const baseline = picks.length >= 4 ? picks.slice(0, 4) : qualifiedPool.slice(0, 4);
  const lean = enforceMlLeanOnPicks(baseline, {
    matchupHistory: result.matchupHistory ?? {},
    qualifiedCandidates: qualifiedPool,
    requestedLegs: target,
  });
  const filled = topUpAfterMlLean({
    picks: lean.picks,
    qualifiedCandidates: qualifiedPool,
    target,
  });
  const added = filled.filter(
    (p) => !lean.picks.some((x) => x.game === p.game && x.market === p.market && x.pick === p.pick),
  );
  synthetic = {
    afterLean: lean.picks.length,
    afterFill: filled.length,
    added: added.map((p) => ({ market: p.market, pick: p.pick, odds: p.odds })),
    addedPeriodBlocked: added.filter((p) => isPostLeanFillBlockedPeriodMarket(p)).length,
  };
}

const note = String(result.note ?? "");
const shortfallMentions = (note.match(/qualified picks were available/i) || []).length;
const shortfallCountMatch = note.match(
  /You asked for (\d+) legs\. (\d+) qualified picks were available/i,
);

const summary = {
  ask: ASK,
  target,
  elapsedMs: Date.now() - t0,
  finalCount: picks.length,
  props: picks.filter((p) => p.isProp).length,
  periodMarketsOnTicket: periodOnTicket.map((p) => ({
    market: p.market,
    pick: p.pick,
  })),
  qualifiedPoolSize: qualifiedPool.length,
  periodBlockedInPool,
  fgAltPool,
  propPool,
  notePreview: note.slice(0, 400),
  shortfallMentions,
  shortfallCountMatch: shortfallCountMatch
    ? { requested: Number(shortfallCountMatch[1]), cited: Number(shortfallCountMatch[2]) }
    : null,
  shortfallCitesFinal:
    !shortfallCountMatch || Number(shortfallCountMatch[2]) === picks.length,
  synthetic,
  ticket: picks.map((p) => ({
    game: p.game,
    market: p.market,
    pick: p.pick,
    odds: p.odds,
    isProp: !!p.isProp,
    period: parseMarketPeriod(p.market ?? ""),
    grade: p.finalAiScore?.grade ?? null,
    simHit: p.finalAiScore?.simHit ?? null,
  })),
};

writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("[sliceA] wrote", OUT);
