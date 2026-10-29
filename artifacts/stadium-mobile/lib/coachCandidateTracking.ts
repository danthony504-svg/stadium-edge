import type { ParsedPick } from "../components/PickCard.tsx";
import type { CoachPropAudit, PropAuditStage } from "./coachPropAudit.ts";

export type CandidateObservation = { stage: PropAuditStage; reason: string };
export type CandidateRow = {
  candidateId: number; kind: "prop" | "game_line";
  sport: string; eventId: string; athleteId: string; market: string; selection: string; game: string; sportsbook: string;
  side: string; line: number | null; odds: number | null;
  observations: CandidateObservation[]; omittedTransitions: number;
  disposition: "selected" | "excluded" | "evaluated_not_selected" | "evaluation_incomplete" | "not_evaluated";
};
export type CandidateReport = {
  version: 1; requestId: string; terminal: "completed" | "timed_out" | "cancelled" | "error";
  requested: number; returned: number; rows: CandidateRow[]; omittedObservations: number;
  coverage: "observed_pipeline_candidates";
};
/** No names, ask text, injuries, tokens or arbitrary error messages leave the device. */
const code = (value: unknown, max = 96) => String(value ?? "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, max);
export function createCandidateTracking(requestId: string, requested: number, maxRows = 1000) {
  const rows = new Map<string, CandidateRow>();
  let omittedObservations = 0, closed = false;
  const keyFor = (p: ParsedPick) => JSON.stringify(p.isProp
    ? [true, p.sport, p.eventId, p.athleteId, p.player, p.game, p.propMarketKey ?? p.market, p.propSide, p.propLine, p.odds, p.sportsbook]
    : [false, p.sport, p.game, p.market, p.pick, p.odds]);
  function observe(p: ParsedPick, stage: PropAuditStage, reason: string) {
    if (closed) return;
    const key = keyFor(p);
    let row = rows.get(key);
    if (!row) {
      let candidateId = rows.size + 1;
      if (rows.size >= maxRows) {
        omittedObservations++;
        if (stage !== "selected") return;
        const victim = [...rows].find(([, value]) => value.disposition !== "selected");
        if (!victim) return;
        candidateId = victim[1].candidateId;
        rows.delete(victim[0]);
      }
      row = { candidateId, kind: p.isProp ? "prop" : "game_line", sport: code(p.sport), eventId: code(p.eventId), athleteId: code(p.athleteId), market: code(p.propMarketKey ?? p.market), selection: p.isProp ? "" : code(p.pick), game: code(p.game), sportsbook: code(p.sportsbook), side: code(p.propSide), line: typeof p.propLine === "number" && Number.isFinite(p.propLine) ? p.propLine : null, odds: Number.isFinite(p.odds) ? p.odds : null, observations: [], omittedTransitions: 0, disposition: "not_evaluated" };
      rows.set(key, row);
    }
    const observation = { stage, reason: code(reason, 240) };
    const last = row.observations.at(-1);
    if (last?.stage !== stage || last.reason !== observation.reason) {
      // Keep the first observation and latest seven gate transitions.
      if (row.observations.length === 8) { row.observations.splice(1, 1); row.omittedTransitions++; }
      row.observations.push(observation);
    }
    if (stage === "selected") row.disposition = "selected";
    else if (stage === "delivery_blocked" || stage === "scope_excluded") row.disposition = "excluded";
    else if (stage === "grading") row.disposition = (reason === "graded" || reason === "qualified_for_staging") ? "evaluated_not_selected" : "excluded";
    else if (stage === "simulation") row.disposition = reason === "simulation_completed" ? "evaluated_not_selected" : "evaluation_incomplete";
  }
  function finish(picks: readonly ParsedPick[], terminal: CandidateReport["terminal"]): CandidateReport {
    for (const p of picks) observe(p, "selected", "selected");
    const selected = new Set(picks.map(keyFor));
    // A partial/earlier selection is never a final selection.
    for (const [key, row] of rows) if (!selected.has(key) && row.disposition === "selected") row.disposition = "evaluated_not_selected";
    closed = true;
    return { version: 1, requestId, requested, returned: picks.length, terminal, rows: [...rows.values()], omittedObservations, coverage: "observed_pipeline_candidates" };
  }
  return { observe, finish };
}
export function trackCandidateAudit(audit: CoachPropAudit, tracking: ReturnType<typeof createCandidateTracking>): CoachPropAudit {
  return { ...audit, observe(p, stage, reason, detail) {
    try { tracking.observe(p, stage, reason); } catch { /* Diagnostics never change selection. */ }
    audit.observe(p, stage, reason, detail);
  } };
}
