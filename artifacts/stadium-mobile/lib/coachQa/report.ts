/**
 * Aggregate Coach QA case results into the master report.
 */

import { EXPLICIT_MARKET_LOCK_RULES } from "../explicitMarketLock.ts";
import type { QaCaseResult, QaFinding, QaReport, Severity } from "./types.ts";
import { COACH_QA_SPORTS } from "./sportsIds.ts";

const SEV_RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function aggregateReport(
  results: QaCaseResult[],
  opts: { seed: number; notes?: string[] } = { seed: 609_2026 },
): QaReport {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  const byCategory: QaReport["byCategory"] = {};
  const findings: QaFinding[] = [];

  for (const r of results) {
    const cat = r.finding?.category ?? r.suite ?? "parser";
    if (!byCategory[cat]) byCategory[cat] = { passed: 0, failed: 0, warnings: 0 };
    if (r.ok) {
      passed += 1;
      byCategory[cat]!.passed += 1;
      if (r.warning) {
        warnings += 1;
        byCategory[cat]!.warnings += 1;
        if (r.finding) findings.push(r.finding);
      }
    } else {
      failed += 1;
      byCategory[cat]!.failed += 1;
      if (r.finding) findings.push(r.finding);
    }
  }

  findings.sort(
    (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.title.localeCompare(b.title),
  );

  const sportMarketMatrix: QaReport["sportMarketMatrix"] = [];
  for (const r of results.filter((x) => x.suite === "market_coverage")) {
    const m = r.meta ?? {};
    sportMarketMatrix.push({
      sport: String(m.sport ?? ""),
      marketFamily: String(m.marketFamily ?? ""),
      requestType: String(m.requestType ?? ""),
      status: (m.status as "PASS" | "FAIL" | "WARN" | "SKIP") ?? (r.ok ? "PASS" : "FAIL"),
      note: r.finding?.title,
    });
  }

  // Ensure matrix has baseline rows even if suite filtered
  if (sportMarketMatrix.length === 0) {
    for (const sport of COACH_QA_SPORTS) {
      for (const rule of EXPLICIT_MARKET_LOCK_RULES.slice(0, 3)) {
        sportMarketMatrix.push({
          sport,
          marketFamily: rule.id,
          requestType: "explicit_lock",
          status: "SKIP",
        });
      }
    }
  }

  const sequential = results.filter((r) => r.suite === "sequential" || r.suite === "fuzz_sequential");
  const fuzz = results.filter((r) => r.suite.startsWith("fuzz"));

  return {
    generatedAt: new Date().toISOString(),
    seed: opts.seed,
    totals: {
      tests: results.length,
      passed,
      failed,
      warnings,
    },
    byCategory,
    findings,
    sportMarketMatrix,
    sequentialSummary: {
      transitions: sequential.filter((r) => r.id.endsWith(":propsOnly") || r.id.includes(":ok") || r.suite === "sequential").length,
      staleLeaks: sequential.filter((r) => !r.ok).length,
    },
    fuzzSummary: {
      sequences: fuzz.length,
      failures: fuzz.filter((r) => !r.ok).length,
    },
    notes: opts.notes ?? [],
  };
}

export function formatMarkdownReport(report: QaReport): string {
  const lines: string[] = [];
  lines.push("# AI COACH QA REPORT");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Seed: ${report.seed}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Total tests | ${report.totals.tests} |`);
  lines.push(`| Passed | ${report.totals.passed} |`);
  lines.push(`| Failed | ${report.totals.failed} |`);
  lines.push(`| Warnings | ${report.totals.warnings} |`);
  lines.push("");
  lines.push("## By category");
  lines.push("");
  lines.push(`| Category | Passed | Failed | Warnings |`);
  lines.push(`|---|---|---|---|`);
  for (const [cat, v] of Object.entries(report.byCategory).sort()) {
    lines.push(`| ${cat} | ${v.passed} | ${v.failed} | ${v.warnings} |`);
  }
  lines.push("");
  lines.push("## Ranked findings");
  lines.push("");
  if (!report.findings.length) {
    lines.push("_No findings._");
  } else {
    let i = 1;
    for (const f of report.findings) {
      if (f.severity === "P3" && f.category === "failure_injection") continue; // keep report readable — still in JSON
      lines.push(`### ${i}. [${f.severity}] ${f.title}`);
      lines.push("");
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **Prompt/sequence:** \`${JSON.stringify(f.promptOrSequence)}\``);
      if (f.seed != null) lines.push(`- **Seed:** ${f.seed}`);
      lines.push(`- **Expected:** ${f.expected}`);
      lines.push(`- **Actual:** ${f.actual}`);
      lines.push(`- **Stage:** ${f.stage}`);
      lines.push(`- **Likely file:** \`${f.likelyFile}\``);
      lines.push(`- **Production affected:** ${f.productionAffected ? "YES" : "no"}`);
      lines.push("");
      i += 1;
      if (i > 80) {
        lines.push(`_… ${report.findings.length - 80} additional findings truncated in markdown (see JSON)._`);
        break;
      }
    }
  }
  lines.push("");
  lines.push("## Sequential / fuzz");
  lines.push("");
  lines.push(`- Sequential checks: ${report.sequentialSummary.transitions}`);
  lines.push(`- Stale-leak failures: ${report.sequentialSummary.staleLeaks}`);
  lines.push(`- Fuzz cases: ${report.fuzzSummary.sequences}`);
  lines.push(`- Fuzz failures: ${report.fuzzSummary.failures}`);
  lines.push("");
  lines.push("## Sport × market × request-type matrix (sample)");
  lines.push("");
  lines.push(`| Sport | Market family | Request type | Status |`);
  lines.push(`|---|---|---|---|`);
  const sample = report.sportMarketMatrix.slice(0, 60);
  for (const row of sample) {
    lines.push(`| ${row.sport} | ${row.marketFamily} | ${row.requestType} | ${row.status} |`);
  }
  if (report.sportMarketMatrix.length > 60) {
    lines.push(`| … | ${report.sportMarketMatrix.length - 60} more rows in JSON | … | … |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const n of report.notes) lines.push(`- ${n}`);
  lines.push("");
  return lines.join("\n");
}

export function countBySeverity(findings: QaFinding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) out[f.severity] += 1;
  return out;
}
