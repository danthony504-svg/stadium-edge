import type { ParsedPick } from "../components/PickCard.tsx";
import { isBinaryNullLineMarket } from "./binaryPropMarket.ts";
import { qualifyCoachCandidate } from "./coach/qualifyCoachCandidate.ts";
import { checkPropProviderProvenance } from "./propProviderProvenance.ts";
import { propProvenanceAllowsSeating } from "./coachPropProbabilityProvenance.ts";
import { pickHasPlayerGameGroundingMismatch } from "./coachReliabilityGrounding.ts";

export type PropAuditStage = "posted" | "scope_excluded" | "eligible" | "simulation" | "grading" | "delivery_blocked" | "selected";
export type PropAuditRow = {
  key: string; sport: string; eventId: string; athleteId: string; player: string;
  game: string; market: string; side: string; line: number | null; odds: number;
  sportsbook: string; stage: PropAuditStage; reason: string; nullReason: string | null;
  grade: string | null; confidence: number | null; edge: number | null; simHit: number | null;
  simulations: number | null; historyGames: number | null; issues: string[];
};
export type PropAuditReport = {
  version: 1; requestId: string; startedAt: string; finishedAt: string;
  terminal: "completed" | "timed_out" | "cancelled" | "error";
  rows: PropAuditRow[]; counts: Record<string, number>; omittedObservations: number;
  coverage: "request_pipeline_only"; verificationLimits: string[];
  /** Final builder delivery, after terminal constraints; not a candidate count. */
  deliveredPickCount?: number; deliveredPropKeys?: string[];
};
const MAX_ROWS = 50_000;
const latest: PropAuditReport[] = [];
let foregroundBuilds = 0;
export function beginCoachPropAuditForeground(): () => void {
  foregroundBuilds++;
  let released = false;
  return () => { if (!released) { released = true; foregroundBuilds--; } };
}
export function propAuditKey(p: ParsedPick): string {
  const side = p.propSide === "Yes" ? "Over" : p.propSide === "No" ? "Under" : p.propSide;
  const line = p.propLine ?? (isBinaryNullLineMarket(p.propMarketKey) ? 0.5 : null);
  return JSON.stringify([p.sport, p.eventId, p.athleteId, p.propMarketKey, side, line, p.odds, p.sportsbook, p.player, p.game]);
}
function snapshot(p: ParsedPick): ParsedPick {
  return { ...p, finalAiScore: p.finalAiScore ? { ...p.finalAiScore,
    propProbabilityProvenance: p.finalAiScore.propProbabilityProvenance ? { ...p.finalAiScore.propProbabilityProvenance } : null } : null,
    propProbabilityProvenance: p.propProbabilityProvenance ? { ...p.propProbabilityProvenance } : null };
}
function numeric(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
const stageRank: Record<PropAuditStage, number> = { posted: 0, scope_excluded: 1, eligible: 2, simulation: 3, grading: 4, delivery_blocked: 5, selected: 6 };
export function createCoachPropAudit(requestId: string, schedule: (work: () => void) => void = work => { setTimeout(work, foregroundBuilds ? 100 : 0); }) {
  const startedAt = new Date().toISOString();
  const entries = new Map<string, { pick: ParsedPick; stage: PropAuditStage; reason: string; nullReason: string | null; historyGames: number | null }>();
  const quotes = new Set<string>();
  let omittedObservations = 0, closed = false;
  function observe(p: ParsedPick, stage: PropAuditStage, reason: string, detail?: { nullReason?: string | null; historyGames?: number | null }) {
    if (closed || !p.isProp) return;
    const key = propAuditKey(p), prior = entries.get(key);
    if (stage === "posted") quotes.add(key);
    if (!prior && entries.size >= MAX_ROWS) { omittedObservations++; return; }
    if (prior && stageRank[prior.stage] > stageRank[stage]) return;
    entries.set(key, { pick: snapshot(p), stage, reason, nullReason: detail && "nullReason" in detail ? detail.nullReason ?? null : prior?.nullReason ?? null,
      historyGames: detail?.historyGames ?? prior?.historyGames ?? null });
  }
  function deliveryIssues(p: ParsedPick): string[] {
    if (!p.isProp) return [];
    const issues: string[] = [];
    if ((p as ParsedPick & { qualificationStatus?: string }).qualificationStatus === "rejected") issues.push("pipeline_explicitly_rejected");
    const provider = checkPropProviderProvenance(p);
    if (!provider.ok) issues.push(...provider.missing.map(f => `missing_provider_${f}`));
    // Never silently approve an uncaptured or altered quote. A bound on audit
    // retention is explicit; it must not manufacture a source match.
    if (!quotes.has(propAuditKey(p))) issues.push("source_quote_not_captured_or_changed");
    const label = String(p.pick ?? "").match(/\b(Over|Under)\s+(-?\d+(?:\.\d+)?)\b/i);
    if (label && (label[1]!.toLowerCase() !== String(p.propSide).toLowerCase() || Number(label[2]) !== p.propLine)) issues.push("display_side_or_line_mismatch");
    if (label && label.index && String(p.pick).slice(0, label.index).trim().toLowerCase() !== String(p.player ?? "").trim().toLowerCase()) issues.push("display_player_mismatch");
    if (pickHasPlayerGameGroundingMismatch(p)) issues.push("player_game_mismatch");
    const prov = p.propProbabilityProvenance ?? p.finalAiScore?.propProbabilityProvenance;
    if (!propProvenanceAllowsSeating(prov, p)) issues.push("simulation_identity_or_evidence_invalid");
    const q = qualifyCoachCandidate({ ...p, qualificationStatus: undefined }, { requestStyle: "normal" });
    if (q.status !== "qualified") issues.push(`quality_${q.reason}`);
    return issues;
  }
  function finish(picks: readonly ParsedPick[], terminal: PropAuditReport["terminal"], publish?: (report: PropAuditReport) => void) {
    if (closed) return;
    // Scalar snapshots prevent deferred review observing another scan's mutation.
    for (const p of picks) observe(p, "selected", "selected");
    const deliveredPickCount = picks.length;
    const deliveredPropKeys = picks.filter(p => p.isProp).map(propAuditKey);
    closed = true;
    const pending = entries.values();
    const rows: PropAuditRow[] = [];
    const counts: Record<string, number> = {};
    const finishedAt = new Date().toISOString();
    function chunk() {
      if (foregroundBuilds) { schedule(chunk); return; }
      for (let i = 0; i < 100; i++) {
        const item = pending.next();
        if (item.done) {
          const report: PropAuditReport = { version: 1, requestId, startedAt, finishedAt, terminal, rows, counts, omittedObservations, deliveredPickCount, deliveredPropKeys, coverage: "request_pipeline_only", verificationLimits: ["No additional provider refresh or simulation rerun", "Quote freshness cannot be verified without source timestamps", "Missing data remains unknown; not-selected does not imply a losing bet"] };
          latest.push(report); latest.sort((a, b) => b.startedAt.localeCompare(a.startedAt)); latest.splice(2);
          try { publish?.(report); } catch { /* audit persistence cannot affect Coach */ }
          entries.clear(); quotes.clear();
          return;
        }
        const { pick: p, stage, reason, nullReason, historyGames } = item.value;
        const score = p.finalAiScore;
        const prov = p.propProbabilityProvenance ?? score?.propProbabilityProvenance;
        const issues = stage === "selected" ? deliveryIssues(p) : [];
        let outcome = reason;
        if (stage === "posted" || stage === "eligible") outcome = "not_simulated_in_this_request";
        if (stage === "grading" && reason === "graded") {
          const q = qualifyCoachCandidate({ ...p, qualificationStatus: undefined }, { requestStyle: "normal" });
          outcome = q.status === "qualified" ? "qualified_not_selected" : `quality_${q.reason}`;
        }
        counts[outcome] = (counts[outcome] ?? 0) + 1;
        for (const issue of issues) counts[`issue:${issue}`] = (counts[`issue:${issue}`] ?? 0) + 1;
        rows.push({ key: propAuditKey(p), sport: p.sport ?? "", eventId: p.eventId ?? "", athleteId: p.athleteId ?? "", player: p.player ?? "",
          game: p.game ?? "", market: p.propMarketKey ?? p.market ?? "", side: p.propSide ?? "", line: numeric(p.propLine), odds: p.odds,
          sportsbook: p.sportsbook ?? "", stage, reason: outcome, nullReason, grade: score?.grade ?? null, confidence: numeric(score?.confidencePct),
          edge: numeric(score?.edgePct), simHit: numeric(score?.simHit), simulations: numeric(prov?.simulations), historyGames, issues });
      }
      schedule(chunk);
    }
    schedule(chunk);
  }
  return { observe, deliveryIssues, finish };
}
export type CoachPropAudit = ReturnType<typeof createCoachPropAudit>;
export function latestCoachPropAudit(): PropAuditReport | null { return latest[0] ?? null; }
