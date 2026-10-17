/**
 * E4 status audit — what is required, what existing data satisfies, blockers.
 * Does not purchase providers, backfill history, score FINAL_EVAL, or request E6.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateE4SegmentConservatism } from "../src/lib/sportSim/ncaafClean/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const DOCS = join(HERE, "../../../docs/coach");
const SNAP_DIR = join(FIX, "ncaaf-pregame-injury-snapshots");

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  const tuningCloses = loadJson<{
    games: Array<{ injuryKnown?: unknown; qbOut?: unknown }>;
  }>(join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json"));
  const phaseCloses = loadJson<{
    games: Array<{ injuryKnown?: unknown; qbOut?: unknown }>;
  }>(join(FIX, "ncaaf-phase-e-closing-lines.json"));
  const feScore = existsSync(join(FIX, "ncaaf-final-eval-frozen-score.json"))
    ? loadJson<Record<string, unknown>>(join(FIX, "ncaaf-final-eval-frozen-score.json"))
    : null;

  const tuningInj = tuningCloses.games.filter((g) => g.injuryKnown != null).length;
  const tuningQb = tuningCloses.games.filter((g) => g.qbOut != null).length;
  const phaseInj = phaseCloses.games.filter((g) => g.injuryKnown != null).length;
  const phaseQb = phaseCloses.games.filter((g) => g.qbOut != null).length;

  const manifestPath = join(SNAP_DIR, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? loadJson<{
        snapshots: Array<{ file: string; captureTimestamp: string }>;
        evidenceRequiredBeforeE4Validation: string[];
      }>(manifestPath)
    : { snapshots: [], evidenceRequiredBeforeE4Validation: [] };

  const snapFiles = existsSync(SNAP_DIR)
    ? readdirSync(SNAP_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json")
    : [];

  // Historical segment check on empty join — expected INSUFFICIENT_DATA
  const segment = evaluateE4SegmentConservatism([]);

  const requirements = [
    {
      id: "R1_pre_kick_snapshots",
      requirement:
        "Snapshots with captureTimestamp < kickoffIso covering Odds-listed FBS games under test (TUNING and/or FINAL_EVAL)",
      satisfiedByExisting: false,
      evidence: `${manifest.snapshots.length} forward ESPN freeze(s); 0 historical holdout joins`,
    },
    {
      id: "R2_join_labels",
      requirement:
        "Join producing injuryKnown=true|null and optional qbOut — never coerce missing→false",
      satisfiedByExisting: false,
      evidence: `TUNING closes non-null injuryKnown=${tuningInj}/${tuningCloses.games.length}; qbOut=${tuningQb}; phase-e injuryKnown=${phaseInj}/${phaseCloses.games.length}`,
    },
    {
      id: "R3_segment_conservatism",
      requirement:
        "mean|edge| on injuryKnown=null ≤ mean|edge| on injuryKnown=true with documented n (≥20 each)",
      satisfiedByExisting: false,
      evidence: segment.detail,
    },
    {
      id: "R4_behavioral_policy",
      requirement:
        "Engine policy for known QB/player absences, stale reports, unavailable data (synthetic tests)",
      satisfiedByExisting: true,
      evidence:
        "e4Availability.ts + ncaafClean.e4Availability.test.ts (behavioral only — not historical predictive validation)",
    },
    {
      id: "R5_no_backfill",
      requirement: "Do not backfill historical labels from live ESPN or post-game box scores",
      satisfiedByExisting: true,
      evidence: "Forward collector + README forbid holdout backfill; policy held",
    },
  ];

  const blockers = [
    "No verified historical pre-kick injury archive for TUNING or FINAL_EVAL games",
    "SportsDataIO / ScoreTape timing not proven / not purchased (see ncaaf-e4-injury-provider.md)",
    "Forward snapshot count insufficient for slate-wide capture < kickoff joins",
    "Segment conservatism unscored on real joins (INSUFFICIENT_DATA)",
  ];

  const status = {
    generatedAt: new Date().toISOString(),
    e4Status: "OPEN_INSUFFICIENT_DATA" as const,
    e4Resolved: false,
    e6Requested: false,
    e6BlockedReason: "E4 unresolved — do not request E6 until E4 clears",
    finalEvalPreserved: feScore
      ? {
          present: true,
          scored: feScore.finalEvalScored === true,
          stamp: feScore.stamp,
          alpha: feScore.alpha,
          retuned: feScore.retuned === true,
        }
      : { present: false },
    behavioralTests: {
      class: "synthetic_behavioral",
      replacesHistoricalPredictiveValidation: false,
      module: "src/lib/sportSim/ncaafClean/e4Availability.ts",
      testFile: "test/ncaafClean.e4Availability.test.ts",
    },
    historicalPredictiveValidation: {
      class: "missing",
      segmentConservatism: segment,
      note: "Synthetic segment tests cannot replace missing historical evidence",
    },
    existingData: {
      tuningCloses: {
        n: tuningCloses.games.length,
        injuryKnownNonNull: tuningInj,
        qbOutNonNull: tuningQb,
      },
      phaseECloses: {
        n: phaseCloses.games.length,
        injuryKnownNonNull: phaseInj,
        qbOutNonNull: phaseQb,
      },
      forwardSnapshots: {
        manifestCount: manifest.snapshots.length,
        filesOnDisk: snapFiles.length,
        dir: "test/fixtures/ncaaf-pregame-injury-snapshots/",
      },
    },
    requirements,
    blockers,
    ops: {
      paidRetrieval: false,
      deployOta: false,
      ncaafUnlock: false,
      spreads: "BLOCKED",
      totals: "BLOCKED",
      alts: "BLOCKED",
    },
  };

  const md = `# E4 injury status — audit

**Status:** \`${status.e4Status}\` · **Resolved:** false · **E6 requested:** false  
**FINAL_EVAL score preserved:** ${feScore ? "yes (no retune)" : "n/a"}  
**Behavioral tests ≠ historical predictive validation**

## What E4 requires

| ID | Requirement | Satisfied by existing data? |
|----|-------------|:---------------------------:|
${requirements.map((r) => `| ${r.id} | ${r.requirement} | **${r.satisfiedByExisting}** |`).join("\n")}

### Evidence notes
${requirements.map((r) => `- **${r.id}:** ${r.evidence}`).join("\n")}

## Existing data inventory

| Source | n | injuryKnown non-null | qbOut non-null |
|--------|--:|---------------------:|---------------:|
| TUNING closes | ${tuningCloses.games.length} | ${tuningInj} | ${tuningQb} |
| Phase-e closes | ${phaseCloses.games.length} | ${phaseInj} | ${phaseQb} |
| Forward ESPN snapshots | ${manifest.snapshots.length} files | n/a (not joined to holdout) | n/a |

## Behavioral policy (done this turn)

Synthetic tests cover:

1. **Known QB / key player absences** — pre-kick usable snapshot → conservative margin tilt + σ widen  
2. **Stale / post-kick reports** — treated as unavailable; **no** invented adjustment  
3. **Unavailable injury data** — \`injuryKnown=null\`; never coerce null/false→healthy  

Module: \`e4Availability.ts\` · Tests: \`ncaafClean.e4Availability.test.ts\`

## Historical predictive validation (still blocked)

Segment conservatism on real joins: **${segment.status}** — ${segment.detail}

> Synthetic tests cannot replace missing historical evidence.

## Remaining blockers

${blockers.map((b) => `- ${b}`).join("\n")}

## E6 gate

**Do not request E6** until E4 is resolved (\`e4Resolved=true\`).

## Ops

No deploy / OTA / unlock · spreads / totals / ALTs blocked · no paid retrieval this audit
`;

  mkdirSync(ART, { recursive: true });
  writeFileSync(join(FIX, "ncaaf-e4-status.json"), JSON.stringify(status, null, 2) + "\n");
  writeFileSync(join(ART, "ncaaf-e4-status.json"), JSON.stringify(status, null, 2) + "\n");
  writeFileSync(join(FIX, "ncaaf-e4-status.md"), md);
  writeFileSync(join(ART, "ncaaf-e4-status.md"), md);
  writeFileSync(join(DOCS, "ncaaf-e4-status.md"), md);
  console.log(
    JSON.stringify(
      {
        e4Status: status.e4Status,
        e4Resolved: false,
        e6Requested: false,
        behavioralDone: true,
        historicalBlocked: true,
      },
      null,
      2,
    ),
  );
}

main();
