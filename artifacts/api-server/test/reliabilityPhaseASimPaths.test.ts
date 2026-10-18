/**
 * Ensures Reliability Phase A CI path filters cover Stage 3 server simulation
 * files so future TD/MC PRs always trigger critical CI.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const REPO = join(process.cwd(), "../..");
const WF = join(REPO, ".github/workflows/reliability-phase-a-ci.yml");

/** Representative Stage 3 server paths that must match pull_request + push filters. */
const STAGE3_SERVER_PATHS = [
  "artifacts/api-server/src/lib/propStatValue.ts",
  "artifacts/api-server/src/lib/monteCarlo.ts",
  "artifacts/api-server/src/lib/monteCarloBuild.ts",
  "artifacts/api-server/src/lib/anytimeTdModel.ts",
  "artifacts/api-server/src/lib/authoritativePlayerHistory.ts",
  "artifacts/api-server/test/stage3TdSimMapping.test.ts",
  "artifacts/api-server/test/footballPropStatValue.test.ts",
  "artifacts/api-server/test/anytimeTdModel.test.ts",
  "artifacts/api-server/test/monteCarlo.test.ts",
  "artifacts/api-server/test/reliabilityPhaseASimPaths.test.ts",
] as const;

function parsePathFilters(src: string, section: "pull_request" | "push"): string[] {
  const re =
    section === "pull_request"
      ? /pull_request:\s*\n\s*paths:\n([\s\S]*?)(?:\n  [a-z_]|\njobs:)/
      : /push:\s*\n\s*branches:[^\n]*\n\s*paths:\n([\s\S]*?)(?:\njobs:)/;
  const m = src.match(re);
  assert.ok(m, `could not locate ${section}.paths in reliability-phase-a-ci.yml`);
  const patterns: string[] = [];
  for (const line of m[1]!.split("\n")) {
    const pm = line.match(/^\s*-\s*"([^"]+)"\s*$/);
    if (pm) patterns.push(pm[1]!);
  }
  assert.ok(patterns.length > 0, `${section}.paths empty`);
  return patterns;
}

function matchesPathFilter(filePath: string, pattern: string): boolean {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${esc}$`).test(filePath);
}

function coveredBy(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPathFilter(filePath, p));
}

test("reliability-phase-a-ci.yml exists", () => {
  assert.equal(existsSync(WF), true);
});

test("Stage 3 server paths match pull_request Reliability Phase A filters", () => {
  const src = readFileSync(WF, "utf8");
  const patterns = parsePathFilters(src, "pull_request");
  for (const filePath of STAGE3_SERVER_PATHS) {
    assert.equal(coveredBy(filePath, patterns), true, filePath);
  }
});

test("Stage 3 server paths match push/main Reliability Phase A filters", () => {
  const src = readFileSync(WF, "utf8");
  const patterns = parsePathFilters(src, "push");
  for (const filePath of STAGE3_SERVER_PATHS) {
    assert.equal(coveredBy(filePath, patterns), true, filePath);
  }
});

test("critical suite script runs Stage 3 server sim tests", () => {
  const script = readFileSync(
    join(REPO, "artifacts/stadium-mobile/scripts/run-reliability-critical-tests.sh"),
    "utf8",
  );
  assert.match(script, /stage3TdSimMapping\.test\.ts/);
  assert.match(script, /reliabilityPhaseASimPaths\.test\.ts/);
});
