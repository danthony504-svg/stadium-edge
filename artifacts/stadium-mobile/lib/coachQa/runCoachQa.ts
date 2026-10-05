/**
 * Master Coach QA harness runner — parser, sequential, fuzz, fixture pipeline.
 * Audit-only: does not change production Coach behavior, thresholds, or deploy.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateRequestMatrix, sequentialTransitionSeeds } from "./matrix.ts";
import {
  runParserMatrixSuite,
  runSequentialSeedSuite,
  checkSequentialTransition,
  describeSnapshot,
} from "./invariants.ts";
import { runFuzzParserSuite, runFuzzSequentialSuite } from "./fuzz.ts";
import {
  runPipelineFixtureSuite,
  runMarketCoverageMatrix,
  runDataQualityFlags,
  runFailureInjectionSuite,
  runPerformanceSmoke,
} from "./pipelineAudit.ts";
import { snapshotAsk } from "./parseSnapshot.ts";
import { aggregateReport, formatMarkdownReport, countBySeverity } from "./report.ts";
import type { QaCaseResult } from "./types.ts";

export const COACH_QA_SEED = 609_2026;

/** Extra auto-generated sequential pairs (hundreds). */
function runAutoSequentialTorture(count = 200): QaCaseResult[] {
  const matrix = generateRequestMatrix();
  const out: QaCaseResult[] = [];
  // Pair many first asks with bare "N leg" / sport follow-ups
  const followUps = [
    "5 leg",
    "6 leg",
    "7 leg",
    "10 leg",
    "5 leg NFL",
    "6 leg NHL",
    "7 leg today",
    "7 leg tomorrow",
  ];
  let i = 0;
  for (const first of matrix) {
    if (i >= count) break;
    const second = followUps[i % followUps.length]!;
    const must = ["marketLock", "propsOnly", "teamExclude"];
    if (/^\d+\s*leg$/i.test(second)) must.push("sport", "teamInclude");
    if (/\b(today|tonight|tomorrow)\b/i.test(second)) must.push("slateDay");
    out.push(
      ...checkSequentialTransition(`auto-${i}`, first.ask, second, must),
    );
    i += 1;
  }
  return out;
}

/** Screenshot sequence deep dump for the report notes. */
export function screenshotSequenceAudit(): Record<string, unknown> {
  const soccer = snapshotAsk("4 leg soccer", []);
  const fiveAfter = snapshotAsk("5 leg", ["4 leg soccer"]);
  const fiveClean = snapshotAsk("5 leg", []);
  return {
    step1_4_leg_soccer: JSON.parse(describeSnapshot(soccer)),
    step2_5_leg_after_soccer: JSON.parse(describeSnapshot(fiveAfter)),
    clean_session_5_leg: JSON.parse(describeSnapshot(fiveClean)),
    stalePropsOnlyConfirmed:
      !fiveClean.propsOnly && fiveAfter.propsOnly === true,
    pathAfterSoccer: fiveAfter.pathHint,
    pathClean: fiveClean.pathHint,
  };
}

export function runCoachQaHarness(opts?: {
  seed?: number;
  fuzzSequential?: number;
  fuzzParser?: number;
  autoSequential?: number;
  outDir?: string;
}): {
  results: QaCaseResult[];
  report: ReturnType<typeof aggregateReport>;
  markdown: string;
  screenshot: Record<string, unknown>;
} {
  const seed = opts?.seed ?? COACH_QA_SEED;
  const results: QaCaseResult[] = [];

  results.push(...runParserMatrixSuite());
  results.push(...runSequentialSeedSuite());
  results.push(...runAutoSequentialTorture(opts?.autoSequential ?? 200));
  results.push(...runFuzzParserSuite(seed, opts?.fuzzParser ?? 500));
  results.push(...runFuzzSequentialSuite(seed, opts?.fuzzSequential ?? 1000));
  results.push(...runPipelineFixtureSuite());
  results.push(...runMarketCoverageMatrix());
  results.push(...runDataQualityFlags());
  results.push(...runFailureInjectionSuite());
  results.push(...runPerformanceSmoke());

  const screenshot = screenshotSequenceAudit();
  const report = aggregateReport(results, {
    seed,
    notes: [
      "Offline harness: parser/state/fuzz/fixture-pipeline only. Large fuzz does not call paid/live APIs.",
      "Live provider end-to-end validation is a separate controlled subset (not executed in this default run).",
      "Documented intentional inheritance: propsOnly only onto explicit slate-day refinements (`N … for tomorrow/tonight/today`). Bare `5 leg` after soccer/player-props must NOT inherit (RC1 fix).",
      `Screenshot sequence stale propsOnly confirmed=${screenshot.stalePropsOnlyConfirmed}`,
      `Matrix size=${generateRequestMatrix().length}; sequential seeds=${sequentialTransitionSeeds().length}`,
      "No production Coach thresholds, selection, merge, deploy, OTA, or EAS build were changed.",
    ],
  });

  const markdown = formatMarkdownReport(report);

  if (opts?.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(join(opts.outDir, "coach-qa-report.json"), JSON.stringify({ report, screenshot, sev: countBySeverity(report.findings) }, null, 2));
    writeFileSync(join(opts.outDir, "coach-qa-report.md"), markdown);
    writeFileSync(
      join(opts.outDir, "coach-qa-results.jsonl"),
      results.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  }

  return { results, report, markdown, screenshot };
}

/** CLI entry when executed directly. */
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const outDir =
    process.env.COACH_QA_OUT ||
    join(dirname(fileURLToPath(import.meta.url)), "reports");
  const { report, markdown, screenshot } = runCoachQaHarness({ outDir });
  console.log(markdown);
  console.log("\n--- screenshot audit ---");
  console.log(JSON.stringify(screenshot, null, 2));
  console.log(
    `\nWrote report to ${outDir} (failed=${report.totals.failed} warnings=${report.totals.warnings})`,
  );
  // Non-zero if P0/P1 failures exist — informational for CI later; harness itself is the deliverable.
  const sev = countBySeverity(report.findings);
  if (sev.P0 + sev.P1 > 0) process.exitCode = 0; // still 0: audit run, not a gate yet
}
