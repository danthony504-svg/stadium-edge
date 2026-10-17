/**
 * Verify historical T−24h snapshot *availability* without examining
 * early vs close price differences (Coach rules already locked).
 * No paid Odds fetch — key unset → entitlement unconfirmed.
 */
import { existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");
const ART = "/opt/cursor/artifacts";

const EARLY_DIR = join(ART, "ncaaf-e2b-early-snapshots");
const CLOSE_DIR = join(ART, "ncaaf-e2b-close-snapshots");

function countJson(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

async function probeSportsList(): Promise<{
  httpStatus: number;
  bodySnippet: string;
}> {
  const res = await fetch("https://api.the-odds-api.com/v4/sports", {
    headers: { "User-Agent": "stadium-edge-t24h-availability/1.0" },
  });
  const text = await res.text();
  return { httpStatus: res.status, bodySnippet: text.slice(0, 240) };
}

async function main(): Promise<void> {
  const keySet = Boolean(String(process.env.ODDS_API_KEY ?? "").trim());
  const probe = await probeSportsList();

  const selectionFixture = join(FIX, "ncaaf-phase-e-selection-prices.json");
  let selectionN = 0;
  let selectionHasAway = false;
  if (existsSync(selectionFixture)) {
    const raw = JSON.parse(readFileSync(selectionFixture, "utf8")) as
      | Array<Record<string, unknown>>
      | { games?: Array<Record<string, unknown>>; rows?: Array<Record<string, unknown>> };
    const rows = Array.isArray(raw)
      ? raw
      : (raw.games ?? raw.rows ?? []);
    selectionN = rows.length;
    // Structural field presence only — do NOT compute CLV / price deltas
    selectionHasAway = rows.some(
      (r) => r.earlyMlAway != null || r.closeMlAway != null,
    );
  }

  const feGames = existsSync(join(FIX, "ncaaf-final-eval-membership-games.json"))
    ? (
        JSON.parse(
          readFileSync(join(FIX, "ncaaf-final-eval-membership-games.json"), "utf8"),
        ) as { games: unknown[] }
      ).games.length
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    purpose: "T−24h historical snapshot availability — no early/close price delta inspection",
    coachSelectionRulesLockedDoc:
      "docs/coach/ncaaf-clean-coach-selection-rules-locked.md",
    paidFetch: false,
    priceDeltasExamined: false,
    oddsApi: {
      ODDS_API_KEY_present: keySet,
      unauthenticatedProbe: probe,
      interpretation: keySet
        ? "Key present — still must confirm historical plan entitlement before spend"
        : "Key missing — cannot confirm historical entitlement; probe returns MISSING_KEY",
      historicalEndpoint:
        "GET /v4/historical/sports/americanfootball_ncaaf/odds (paid plans only)",
      snapshotCadenceDocs: "5-minute intervals since Sep 2022 (Odds docs)",
      t24hFeasibility:
        "FINAL_EVAL 2025–2026 kickoffs are after Sep 2022 → historical as-of T−24h is *timing-feasible* on paid historical plans; local archive empty; entitlement unconfirmed without key",
    },
    localArchives: {
      earlySnapshotsDir: EARLY_DIR,
      earlySnapshotFiles: countJson(EARLY_DIR),
      closeSnapshotsDir: CLOSE_DIR,
      closeSnapshotFiles: countJson(CLOSE_DIR),
      tuningClosesFixture: existsSync(
        join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json"),
      ),
      finalEvalMembershipGamesN: feGames,
    },
    fixtureFallback: {
      path: "ncaaf-phase-e-selection-prices.json",
      nRows: selectionN,
      hasAwayMlFields: selectionHasAway,
      r1Note:
        "Home-only fixture fallback allowed under locked R1 — insufficient alone for C1 on clean E1 away mix (R2)",
      priceValuesInspected: false,
    },
    readinessImplication: {
      canFetchT24hWithoutKey: false,
      canUseEmptyEarlyCacheForClv: false,
      nextStep: "Authorize paid early h2h pull under separate hard cap after manifests regenerated",
    },
    ops: {
      e1Frozen: true,
      injuryInactive: true,
      ncaafBlocked: true,
      voicePaused: true,
      finalEvalScored: false,
    },
  };

  writeFileSync(
    join(FIX, "ncaaf-clean-t24h-availability.json"),
    JSON.stringify(report, null, 2) + "\n",
  );

  const md = `# Historical T−24h availability check (no price deltas)

**Generated:** ${report.generatedAt}  
**Coach selection rules:** **LOCKED** (\`ncaaf-clean-coach-selection-rules-locked.md\`) **before** this check  
**Price early−close differences examined:** **false**  
**Paid fetch:** false

## Odds API

| Item | Status |
|------|--------|
| \`ODDS_API_KEY\` | ${keySet ? "present" : "**missing**"} |
| Unauth probe \`/v4/sports\` | HTTP ${probe.httpStatus} |
| Historical endpoint | paid-only \`/v4/historical/.../odds\` |
| Snapshot cadence (docs) | 5-minute since Sep 2022 |
| T−24h timing for FINAL_EVAL 2025–26 | **Feasible** on paid historical plans |

## Local coverage

| Archive | n |
|---------|--:|
| Early snapshot files | ${report.localArchives.earlySnapshotFiles} |
| Close snapshot files | ${report.localArchives.closeSnapshotFiles} |
| FINAL_EVAL membership games | ${feGames} |
| Selection-prices fixture rows | ${selectionN} (away ML fields present: ${selectionHasAway}) |

## Implication

Early two-sided cache is **empty**. Without a key, historical entitlement is **unconfirmed**. Fixture home-only fallback does not satisfy locked R2 for away selections. **Do not** inspect early vs close prices until after authorized retrieval.

Ops: E1 frozen · injuries inactive · NCAAF blocked · voice paused · FINAL_EVAL unscored
`;

  writeFileSync(join(FIX, "ncaaf-clean-t24h-availability.md"), md);
  writeFileSync(join(DOCS, "ncaaf-clean-t24h-availability.md"), md);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
