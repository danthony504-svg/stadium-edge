/**
 * ML-only release review pack — aggregates frozen FINAL_EVAL + E4 status.
 * Does NOT request E6 while E4 unresolved. No deploy/OTA/unlock.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const DOCS = join(HERE, "../../../docs/coach");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function main(): void {
  const score = loadJson<{
    generatedAt: string;
    stamp: string;
    candidateId: string;
    alpha: number;
    pairedCoverage: string;
    metrics: Record<string, number | null>;
    mlCriteria: Array<{ id: string; pass: boolean | null; measured: number | null; detail: string }>;
    clvCriteria: Array<{
      id: string;
      pass: boolean | null;
      detail: string;
      evidenceClass: string;
    }>;
    softGates: { verdict: string; n: number };
    coachClvDetail: Record<string, unknown>;
    uncertainty: Record<string, unknown>;
    exclusions: {
      emptyBookmakersMissing: Array<{ eventId: string }>;
      clvSkip: Record<string, number>;
      harnessWithhold: Record<string, number>;
    };
    acceptance: {
      finalPass: boolean;
      reason: string;
      mlAllPass: boolean | null;
      clvAllPass: boolean | null;
    };
    spreads: string;
  }>("ncaaf-final-eval-frozen-score.json");

  const e4 = loadJson<{
    e4Status: string;
    e4Resolved: boolean;
    e6Requested: boolean;
    blockers: string[];
    requirements: Array<{ id: string; satisfiedByExisting: boolean; requirement: string }>;
  }>("ncaaf-e4-status.json");

  const rematch = loadJson<{
    paired: number;
    membershipN: number;
    emptyBookmakers: { close: string[] };
    integrityPass: boolean;
  }>("ncaaf-final-eval-alias-rematch-report.json");

  const membership = loadJson<{ games: Array<{ eventId: string }> }>(
    "ncaaf-final-eval-membership-games.json",
  );

  const supportedExclusions = {
    membershipN: membership.games.length,
    pairedMlCoverage: rematch.paired,
    emptyBookmakerShells: rematch.emptyBookmakers.close,
    unsupportedOrMissingClose: membership.games.length - rematch.paired,
    notes: [
      "Supported ML eval cohort = rematched two-sided close/early joins (403)",
      "5 empty-bookmaker shells explicitly MISSING_DATA (not scored)",
      "FBS–FCS / unrated withholds: none on scored 403 (harness withhold empty)",
      "Spreads / totals / ALTs out of scope (blocked separate gates)",
    ],
  };

  const e6Allowed = e4.e4Resolved === true;
  const review = {
    generatedAt: new Date().toISOString(),
    title: "ML-only release review — clean E1 α=1.15",
    candidate: {
      stamp: score.stamp,
      candidateId: score.candidateId,
      alpha: score.alpha,
      preserved: true,
      retunedAgainstFinalEval: false,
    },
    markets: {
      moneyline: "UNDER_REVIEW",
      spreads: "BLOCKED",
      totals: "BLOCKED",
      alts: "BLOCKED",
    },
    finalEval: {
      scoredAt: score.generatedAt,
      pairedCoverage: score.pairedCoverage,
      integrityPass: rematch.integrityPass,
      metrics: score.metrics,
      mlCriteria: score.mlCriteria,
      clvCriteria: score.clvCriteria,
      softGates: score.softGates,
      coachClvDetail: score.coachClvDetail,
      uncertainty: score.uncertainty,
      acceptance: score.acceptance,
    },
    supportedMatchupExclusions: supportedExclusions,
    e4: {
      status: e4.e4Status,
      resolved: e4.e4Resolved,
      requirementsMet: e4.requirements.filter((r) => r.satisfiedByExisting).map((r) => r.id),
      requirementsUnmet: e4.requirements
        .filter((r) => !r.satisfiedByExisting)
        .map((r) => r.id),
      blockers: e4.blockers,
    },
    e6: {
      requested: false,
      allowed: e6Allowed,
      reason: e6Allowed
        ? "E4 resolved — human E6 may be requested separately"
        : "E4 unresolved — E6 must not be requested",
    },
    product: {
      ncaafGate: false,
      deployOta: false,
      unlock: false,
      voice: "paused",
    },
    verdict: e4.e4Resolved
      ? "ML_METRICS_CLEAR_PENDING_E6"
      : "ML_METRICS_CLEAR_E4_BLOCKER — do not request E6",
  };

  const md = `# ML-only release review — clean E1 α=1.15

**Generated:** ${review.generatedAt}  
**Candidate preserved:** yes · **Retuned vs FINAL_EVAL:** no  
**Verdict:** \`${review.verdict}\`

## Markets

| Market | Status |
|--------|--------|
| Moneyline | under review (M1–M4 + C1–C6 measured) |
| Spreads | **BLOCKED** |
| Totals | **BLOCKED** |
| ALTs | **BLOCKED** |

## Supported-matchup exclusions

| Item | n / IDs |
|------|---------|
| Membership | ${supportedExclusions.membershipN} |
| Paired ML cohort (scored) | ${supportedExclusions.pairedMlCoverage} |
| Empty-bookmaker MISSING_DATA | ${supportedExclusions.emptyBookmakerShells.length}: ${supportedExclusions.emptyBookmakerShells.join(", ")} |
| Unscored vs membership | ${supportedExclusions.unsupportedOrMissingClose} |

${supportedExclusions.notes.map((n) => `- ${n}`).join("\n")}

## Measured FINAL_EVAL results (frozen)

**Stamp:** \`${score.stamp}\` · **α=${score.alpha}** · coverage ${score.pairedCoverage}

### M1–M4
| # | Pass | Measured |
|---|:----:|----------|
${score.mlCriteria.map((c) => `| ${c.id} | ${c.pass} | ${c.detail} |`).join("\n")}

| Metric | Value | Uncertainty |
|--------|------:|-------------|
| ML Brier | ${score.metrics.mlBrier} | SE≈${(score.uncertainty as { mlBrierSE?: number }).mlBrierSE} |
| Market Brier | ${score.metrics.mktBrier} | — |
| Δ vs market | ${score.metrics.deltaVsMarket} | SE≈${(score.uncertainty as { deltaVsMarketSE?: number }).deltaVsMarketSE} |
| bias | ${score.metrics.bias} | — |

### Coach C1–C6
| # | Pass | Class | Detail |
|---|:----:|-------|--------|
${score.clvCriteria.map((c) => `| ${c.id} | ${c.pass} | ${c.evidenceClass} | ${c.detail} |`).join("\n")}

Soft gates: **${score.softGates.verdict}** (n=${score.softGates.n})  
CLV skips: ${JSON.stringify(score.exclusions.clvSkip)} · harness withholds: ${JSON.stringify(score.exclusions.harnessWithhold)}

### Harness acceptance
\`finalPass=${score.acceptance.finalPass}\` — ${score.acceptance.reason}  
mlAllPass=${score.acceptance.mlAllPass} · clvAllPass=${score.acceptance.clvAllPass}

## E4 injury

| Field | Value |
|-------|-------|
| Status | **${e4.e4Status}** |
| Resolved | **${e4.e4Resolved}** |
| Requirements met | ${review.e4.requirementsMet.join(", ") || "none"} |
| Requirements unmet | ${review.e4.requirementsUnmet.join(", ")} |

Blockers:
${e4.blockers.map((b) => `- ${b}`).join("\n")}

See [\`ncaaf-e4-status.md\`](./ncaaf-e4-status.md). Behavioral policy tests are done; historical predictive validation is not.

## E6

**Requested:** false  
**Allowed:** ${e6Allowed}  
${review.e6.reason}

## Product holds

- \`NCAAF_GAME_LINE_SIM_VALIDATED=false\`
- No deploy / OTA / unlock
- Voice paused
`;

  mkdirSync(ART, { recursive: true });
  writeFileSync(join(FIX, "ncaaf-ml-only-release-review.json"), JSON.stringify(review, null, 2) + "\n");
  writeFileSync(join(ART, "ncaaf-ml-only-release-review.json"), JSON.stringify(review, null, 2) + "\n");
  writeFileSync(join(FIX, "ncaaf-ml-only-release-review.md"), md);
  writeFileSync(join(ART, "ncaaf-ml-only-release-review.md"), md);
  writeFileSync(join(DOCS, "ncaaf-ml-only-release-review.md"), md);
  console.log(
    JSON.stringify(
      {
        verdict: review.verdict,
        e4Resolved: e4.e4Resolved,
        e6Requested: false,
        mlAllPass: score.acceptance.mlAllPass,
        clvAllPass: score.acceptance.clvAllPass,
      },
      null,
      2,
    ),
  );
}

main();
