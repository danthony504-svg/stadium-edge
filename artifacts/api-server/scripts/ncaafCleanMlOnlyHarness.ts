/**
 * Phase A — run ML-only harness on TUNING (screen) with frozen E1 α=1.15.
 * Does NOT score FINAL_EVAL. No paid retrieval. Spreads blocked (separate gate).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLEAN_E1_ALPHA,
  runMlOnlyHarness,
  type CleanFixtureGameRow,
} from "../src/lib/sportSim/ncaafClean/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

const finish = loadJson<{
  exclusions: Array<{ eventId: string; reason: string }>;
}>("ncaaf-tuning-identical-334-finish.json");
const tuningDoc = loadJson<{ games: CleanFixtureGameRow[] }>(
  "ncaaf-tuning-2025-w1-7-games.json",
);
const phaseEDoc = loadJson<{ games?: CleanFixtureGameRow[] } | CleanFixtureGameRow[]>(
  "ncaaf-phase-e-games.json",
);
const phaseE = Array.isArray(phaseEDoc)
  ? phaseEDoc
  : (phaseEDoc.games as CleanFixtureGameRow[]);
const closesArr = loadJson<{
  games: Array<{
    gameId: string;
    closeMlHome?: number | null;
    closeMlAway?: number | null;
  }>;
}>("ncaaf-tuning-2025-w1-7-closing-lines.json").games;
const closes = new Map(closesArr.map((c) => [String(c.gameId), c]));
const tags = new Map(
  loadJson<{ games: Array<{ eventId: string; matchupSubdivision: string }> }>(
    "ncaaf-tuning-2025-w1-7-games.subdivision-tags.json",
  ).games.map((g) => [String(g.eventId), g.matchupSubdivision]),
);
const unrated = new Set(
  finish.exclusions.filter((e) => e.reason === "unrated_fbs_side").map((e) => e.eventId),
);

const identicalIds = new Set(
  [...closes.keys()].filter((eid) => {
    const c = closes.get(eid)!;
    if (c.closeMlHome == null) return false;
    if (tags.get(eid) !== "fbs_fbs") return false;
    if (unrated.has(eid)) return false;
    return true;
  }),
);

const report = runMlOnlyHarness({
  split: "TUNING",
  allowFinalEvalScoring: false,
  season: 2025,
  seedGames: phaseE.filter((g) => g.season === 2024),
  walkGames: tuningDoc.games,
  scoreEventIds: identicalIds,
  closes,
  useVenueSidecar: true,
  e4InjuryValidated: false,
  clv: {
    available: false,
    nMlWithClv: null,
    meanClvProbPoints: null,
    pctSelectionsBeatClose: null,
    homeSelections: null,
    awaySelections: null,
    softGatesOk: null,
    earlyCachePicks: null,
    note: "Clean E1 CLV missing — early two-sided cache empty; phase-e prior fail is failed evidence on old stamp only",
  },
});

const out = {
  generatedAt: new Date().toISOString(),
  phase: "A",
  paidRetrieval: false,
  finalEvalScored: false,
  ...report,
};

writeFileSync(
  join(FIX, "ncaaf-clean-ml-only-harness-tuning.json"),
  JSON.stringify(out, null, 2) + "\n",
);

const md = `# ML-only harness — TUNING screen (Phase A)

**Candidate:** frozen clean E1 **α=${CLEAN_E1_ALPHA}**  
**Generated:** ${out.generatedAt}  
**Split:** TUNING (screen only) · **FINAL_EVAL scored:** false  
**Spreads:** BLOCKED (separate gate — S2 does not auto-fail ML)  
**Ops:** no spend · no deploy/OTA/unlock · voice paused · gate false

## Locked criteria (unchanged)

M1 n≥200 · M2 Brier&lt;0.25 · M3 ≤ mkt+0.02 · M4 \|bias\|≤0.08 · CLV C1–C6 (C2 meanClv≥0)

## TUNING screen metrics

| Metric | Value |
|--------|------:|
| nML | ${report.metrics.nMl} |
| ML Brier | ${report.metrics.mlBrier} |
| Mkt Brier | ${report.metrics.mktBrier} |
| Δ vs mkt | ${report.metrics.deltaVsMarket} |
| bias | ${report.metrics.bias} |

## Criterion results (screen — not FINAL_EVAL PASS)

${report.mlCriteria.map((c) => `- **${c.id}**: pass=${c.pass} · ${c.detail}`).join("\n")}

### CLV

${report.clvCriteria.map((c) => `- **${c.id}**: ${c.evidenceClass} · pass=${c.pass} · ${c.detail}`).join("\n")}

## Acceptance

\`finalPass=${report.acceptance.finalPass}\` — ${report.acceptance.reason}

## Notes

${report.notes.map((n) => `- ${n}`).join("\n")}

Withholds: \`${JSON.stringify(report.withhold)}\`
`;

writeFileSync(join(FIX, "ncaaf-clean-ml-only-harness-tuning.md"), md);
writeFileSync(join(DOCS, "ncaaf-clean-ml-only-harness-tuning.md"), md);
console.log(JSON.stringify({ nMl: report.metrics.nMl, delta: report.metrics.deltaVsMarket, finalPass: report.acceptance.finalPass, ml: report.mlCriteria }, null, 2));
