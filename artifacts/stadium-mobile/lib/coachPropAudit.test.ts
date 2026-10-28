import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { quoteTimeEvidence, beginCoachPropAuditForeground, createCoachPropAudit, propAuditKey, type PropAuditReport } from "./coachPropAudit.ts";
import { exactMarket10kProvenance } from "./coachPropProbabilityProvenance.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
function pick(patch: Partial<ParsedPick> = {}): ParsedPick {
  const p = { isProp: true, sport: "nba", market: "Points", propMarketKey: "player_points", player: "Test Player", athleteId: "a1", eventId: "e1", game: "Away @ Home", propSide: "Over", propLine: 10.5, pick: "Test Player Over 10.5 Points", odds: -110, sportsbook: "book", ...patch } as ParsedPick;
  p.propProbabilityProvenance = exactMarket10kProvenance({ hitProbability: .7, simulations: 10000, sport: p.sport, athleteId: p.athleteId, eventId: p.eventId, marketKey: p.propMarketKey, side: p.propSide, line: p.propLine });
  p.finalAiScore = { grade: "B+", confidencePct: 65, edgePct: 17.6, simHit: .7 } as ParsedPick["finalAiScore"];
  return p;
}
function collector(id = "req") { const tasks: Array<() => void> = []; const audit = createCoachPropAudit(id, task => tasks.push(task)); return { audit, tasks, flush() { while (tasks.length) tasks.shift()!(); } }; }

test("delivery checks bind source quote, display, exact simulation and independent quality", () => {
  const { audit } = collector(); const p = pick(); audit.observe(p, "posted", "posted");
  assert.deepEqual(audit.deliveryIssues(p), []);
  for (const patch of [{ odds: -200 }, { eventId: "other" }, { athleteId: "other" }, { propMarketKey: "player_rebounds" }, { propLine: 11.5 }, { sportsbook: "other" }]) {
    assert.ok(audit.deliveryIssues({ ...p, ...patch }).includes("source_quote_not_captured_or_changed"));
  }
  assert.ok(audit.deliveryIssues({ ...p, propLine: 11.5 }).includes("simulation_identity_or_evidence_invalid"));
  assert.ok(audit.deliveryIssues({ ...p, pick: "Test Player Under 10.5 Points" }).includes("display_side_or_line_mismatch"));
  assert.ok(audit.deliveryIssues({ ...p, pick: "Other Player Over 10.5 Points" }).includes("display_player_mismatch"));
  const bad = { ...p, qualificationStatus: "qualified", finalAiScore: { ...p.finalAiScore, confidencePct: 51 } } as ParsedPick;
  assert.ok(audit.deliveryIssues(bad).includes("quality_confidence_floor"));
  assert.deepEqual(audit.deliveryIssues({ ...p, isProp: false }), []);
});

test("each captured candidate has a truthful terminal reason, without fabricating unrun grades", () => {
  const c = collector(); const result: { report?: PropAuditReport } = {};
  const posted = pick(), scoped = pick({ athleteId: "scoped" }), missing = pick({ athleteId: "missing" }), good = pick({ athleteId: "good" }), selected = pick({ athleteId: "selected" });
  for (const p of [posted, scoped, missing, good, selected]) c.audit.observe(p, "posted", "posted");
  c.audit.observe(scoped, "scope_excluded", "request_scope_or_pre_sim_grounding");
  c.audit.observe(missing, "simulation", "simulation_unavailable", { nullReason: "stat_mapping_failed", historyGames: 0 });
  c.audit.observe(good, "grading", "graded");
  c.audit.finish([selected], "completed", r => { result.report = r; });
  assert.equal(result.report, undefined, "heavy report is deferred beyond ticket completion");
  selected.finalAiScore!.confidencePct = 1; // snapshots must not drift
  c.flush(); const report = result.report as PropAuditReport | undefined; assert.ok(report);
  assert.equal(report.rows.length, 5);
  assert.equal(report.deliveredPickCount, 1);
  assert.deepEqual(report.deliveredPropKeys, [propAuditKey(selected)]);
  assert.equal(report.counts.not_simulated_in_this_request, 1);
  assert.equal(report.counts.qualified_not_selected, 1);
  assert.equal(report.rows.find(r => r.athleteId === "missing")?.nullReason, "stat_mapping_failed");
  assert.equal(report.rows.find(r => r.athleteId === "selected")?.confidence, 65);
  assert.deepEqual(report.rows.find(r => r.athleteId === "selected")?.issues, []);
});

test("concurrent requests are isolated; cancelled work closes recording; repeated finish is idempotent", () => {
  const a = collector("a"), b = collector("b"), p = pick();
  a.audit.observe(p, "posted", "posted");
  assert.ok(b.audit.deliveryIssues(p).includes("source_quote_not_captured_or_changed"));
  let reports = 0; a.audit.finish([], "cancelled", r => { reports++; assert.equal(r.terminal, "cancelled"); assert.equal(r.rows.length, 1); });
  a.audit.observe(pick({ athleteId: "late" }), "posted", "posted"); a.audit.finish([], "completed"); a.flush(); assert.equal(reports, 1);
});

test("binary Yes/No normalization retains the exact posted quote", () => {
  const a = collector().audit;
  const raw = pick({ market: "Anytime TD", propMarketKey: "player_anytime_td", sport: "nfl", propSide: "Yes", propLine: null, pick: "Test Player Anytime TD" });
  const normalized = pick({ ...raw, propSide: "Over", propLine: .5, pick: "Test Player Over 0.5 Anytime TD" });
  assert.equal(propAuditKey(raw), propAuditKey(normalized)); a.observe(raw, "posted", "posted");
  assert.ok(!a.deliveryIssues(normalized).includes("source_quote_not_captured_or_changed"));
});

test("large boards are reviewed in chunks after completion; instrumentation requires no network", () => {
  const c = collector("large"); const p = pick(); const start = performance.now();
  for (let i = 0; i < 4000; i++) c.audit.observe({ ...p, athleteId: String(i) }, "posted", "posted");
  const recordMs = performance.now() - start; const result: { report?: PropAuditReport } = {};
  c.audit.finish([], "timed_out", r => { result.report = r; }); assert.equal(c.tasks.length, 1);
  c.tasks.shift()!(); assert.equal(result.report, undefined); assert.equal(c.tasks.length, 1);
  c.flush(); const report = result.report as PropAuditReport | undefined; assert.equal(report?.rows.length, 4000);
  assert.ok(recordMs < 500, `unexpected instrumentation regression: ${recordMs}ms`);
  console.log(`prop audit: 4000 observations ${recordMs.toFixed(1)}ms; deferred chunks of 100`);
});


test("deferred review yields whenever a new foreground Coach build is active", () => {
  const c = collector("foreground"), p = pick(); let published = false;
  c.audit.observe(p, "posted", "posted"); c.audit.finish([], "completed", () => { published = true; });
  const release = beginCoachPropAuditForeground();
  c.tasks.shift()!(); assert.equal(published, false); assert.equal(c.tasks.length, 1);
  release(); release(); c.flush(); assert.equal(published, true);
});

test("source quote time remains unknown when unavailable", () => {
 const now=Date.parse("2026-10-25T12:00:00Z");
 assert.equal(quoteTimeEvidence(null,now).sourceTimeState,"unknown");
 assert.equal(quoteTimeEvidence("invalid",now).sourceAgeMs,null);
 assert.equal(quoteTimeEvidence("2026-10-25T11:58:00Z",now).sourceAgeMs,120000);
 assert.equal(quoteTimeEvidence("2026-10-25T12:01:00Z",now).sourceTimeState,"future_timestamp");
});

test("unevaluated candidates retain explicit scan exclusions instead of generic not-simulated labels", () => {
  const c = collector();
  const reasons = ["scan_distribution_budget", "scan_cancelled", "scan_deadline", "scan_ticket_target_reached", "shared_draw_exact_line_response_missing"];
  for (const [i, reason] of reasons.entries()) {
    const p = pick({ athleteId: `unscored-${i}` });
    c.audit.observe(p, "eligible", "eligible");
    c.audit.observe(p, "not_evaluated", reason);
  }
  let report: PropAuditReport | undefined;
  c.audit.finish([], "completed", r => {report = r;}); c.flush();
  for (const reason of reasons) assert.equal(report!.counts[reason], 1);
  assert.equal(report!.counts.not_simulated_in_this_request, undefined);
});

test("generic unscanned reason cannot replace an authenticated simulation failure",()=>{
 const c=collector();const p=pick();let report:PropAuditReport|undefined;
 c.audit.observe(p,"posted","posted");
 c.audit.observe(p,"simulation","simulation_unavailable",{nullReason:"insufficient_game_log"});
 c.audit.observe(p,"not_evaluated","shared_draw_exact_line_response_missing");
 c.audit.finish([],"completed",r=>{report=r});c.flush();
 assert.equal(report?.rows[0]?.nullReason,"insufficient_game_log");
});

test("missing opponent evidence retains its reason instead of becoming generic not simulated",()=>{
 const c=collector();const p=pick();c.audit.observe(p,"posted","posted");c.audit.observe(p,"eligible","missing_opponent_defense");let report:PropAuditReport|undefined;
 c.audit.finish([],"completed",r=>report=r);c.flush();assert.equal(report?.counts.missing_opponent_defense,1);assert.equal(report?.counts.not_simulated_in_this_request,undefined);
});
