/**
 * Phase E gate board — tracks which acceptance criteria are ready.
 * Never flips NCAAF_GAME_LINE_SIM_VALIDATED.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

test("Phase E seal: NCAAF_GAME_LINE_SIM_VALIDATED stays false", async () => {
  const mod = await import("../../stadium-mobile/lib/coachP0UnvalidatedTotals.ts");
  assert.equal(mod.NCAAF_GAME_LINE_SIM_VALIDATED, false);
  assert.equal(
    mod.isP0UnvalidatedNcaafGameLineMarket({ market: "Spread", sport: "ncaaf" }),
    true,
  );
});

test("Phase E checklist doc exists and forbids silent restore", () => {
  const doc = readFileSync(
    join(repoRoot, "docs/coach/ncaaf-phase-e-checklist.md"),
    "utf8",
  );
  assert.match(doc, /NCAAF_GAME_LINE_SIM_VALIDATED/);
  assert.match(doc, /stays `false`|do not flip|Restore readiness:\*\* \*\*NO/i);
  assert.match(doc, /E2a/);
  assert.match(doc, /E6/);
  assert.match(doc, /home-win underprediction|bias/i);
});

test("Phase E calibration report keeps P0 armed", () => {
  const reportPath = join(
    here,
    "../test/fixtures/ncaaf-phase-e-calibration-report.json",
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    keepP0Armed?: boolean;
    flagFlipAllowed?: boolean;
    verdicts?: Record<string, string>;
  };
  assert.equal(report.keepP0Armed, true);
  assert.equal(report.flagFlipAllowed, false);
  assert.match(String(report.verdicts?.NCAAF_GAME_LINE_SIM_VALIDATED), /false/i);
});

test("Phase E2b closing archive uses pre-kickoff snaps (not midday-only)", () => {
  const archPath = join(here, "../test/fixtures/ncaaf-phase-e-closing-lines.json");
  const e2bPath = join(here, "../test/fixtures/ncaaf-phase-e-e2b-report.json");
  const arch = JSON.parse(readFileSync(archPath, "utf8")) as {
    closingDefinition?: string;
    games?: Array<{
      closeSnapshotTimestamp?: string;
      oddsCommenceTime?: string;
      injuryKnown?: boolean | null;
      closeMlHome?: number | null;
    }>;
    missing?: unknown[];
  };
  const e2b = JSON.parse(readFileSync(e2bPath, "utf8")) as {
    matchedWithFullPrices?: number;
    verdicts?: Record<string, string>;
    keepP0Armed?: boolean;
  };
  assert.match(String(arch.closingDefinition), /date=kickoff|pre-kickoff|≤ kickoff/i);
  assert.ok((arch.games?.length ?? 0) >= 200, "need a meaningful close archive");
  assert.ok((e2b.matchedWithFullPrices ?? 0) >= 200);
  assert.equal(e2b.keepP0Armed, true);
  assert.match(String(e2b.verdicts?.NCAAF_GAME_LINE_SIM_VALIDATED), /false/i);
  // Missing injury must not be coerced to false on archive rows
  const coerced = (arch.games ?? []).filter((g) => g.injuryKnown === false);
  assert.equal(coerced.length, 0, "do not treat missing injury as no-injury");
  let checked = 0;
  for (const g of arch.games ?? []) {
    if (!g.closeSnapshotTimestamp || !g.oddsCommenceTime) continue;
    assert.ok(
      g.closeSnapshotTimestamp < g.oddsCommenceTime,
      `close snap must be before commence: ${g.closeSnapshotTimestamp} < ${g.oddsCommenceTime}`,
    );
    checked += 1;
    if (checked >= 50) break;
  }
  assert.ok(checked >= 50);
});

test("Phase E Coach pick CLV report has no CLV PASS and mixed sides", () => {
  const path = join(
    here,
    "../test/fixtures/ncaaf-phase-e-coach-pick-clv-report.json",
  );
  const r = JSON.parse(readFileSync(path, "utf8")) as {
    simulationsPerGame?: number;
    funnel?: {
      selectedPicks?: number;
      homeSelections?: number;
      awaySelections?: number;
    };
    coachPickClv?: { meanClvProbPoints?: number };
    outcomes?: { hitRate?: number; wilson95?: { lo?: number; hi?: number } };
    untouchedPeriodMarketBaseline?: {
      nGames?: number;
      marketBrierCloseMl?: number;
    };
    injuryKnown?: unknown;
    verdicts?: Record<string, string>;
    keepP0Armed?: boolean;
    flagFlipAllowed?: boolean;
  };
  assert.equal(r.simulationsPerGame, 10000);
  assert.ok((r.funnel?.selectedPicks ?? 0) >= 1);
  assert.ok((r.funnel?.homeSelections ?? 0) >= 1);
  assert.ok(
    (r.funnel?.awaySelections ?? 0) >= 1,
    "must not be blanket home — away selections required",
  );
  assert.ok(typeof r.coachPickClv?.meanClvProbPoints === "number");
  assert.ok(typeof r.outcomes?.hitRate === "number");
  assert.ok(typeof r.outcomes?.wilson95?.lo === "number");
  assert.ok((r.untouchedPeriodMarketBaseline?.nGames ?? 0) >= 100);
  assert.ok(
    (r.untouchedPeriodMarketBaseline?.marketBrierCloseMl ?? 1) < 0.25,
  );
  assert.equal(r.injuryKnown, null);
  assert.equal(r.keepP0Armed, true);
  assert.equal(r.flagFlipAllowed, false);
  assert.match(String(r.verdicts?.E2b_coachPickClv), /COMPUTED_NO_PASS_LABEL/);
  assert.doesNotMatch(String(r.verdicts?.E2b_coachPickClv), /^PASS$/i);
  assert.match(String(r.verdicts?.NCAAF_GAME_LINE_SIM_VALIDATED), /false/i);
  assert.match(String(r.verdicts?.E4_injuryConservatism), /INSUFFICIENT/i);
  assert.match(String(r.verdicts?.E6_humanSignOff), /OPEN/i);
});

test("Phase E e2b report separates soft gates from Coach pick CLV", () => {
  const e2bPath = join(here, "../test/fixtures/ncaaf-phase-e-e2b-report.json");
  const e2b = JSON.parse(readFileSync(e2bPath, "utf8")) as {
    closeArchiveSoftGates?: { note?: string; status?: string };
    coachPickClv?: { verdict?: string; simulations?: number };
    verdicts?: Record<string, string>;
  };
  assert.match(String(e2b.closeArchiveSoftGates?.note), /NOT Coach pick CLV/i);
  assert.doesNotMatch(String(e2b.closeArchiveSoftGates?.status), /CLV PASS/i);
  assert.equal(e2b.coachPickClv?.simulations, 10000);
  assert.equal(e2b.coachPickClv?.verdict, "COMPUTED_NO_PASS_LABEL");
  assert.equal(e2b.verdicts?.E2b_coachPickClv, "COMPUTED_NO_PASS_LABEL");
});

test("Phase E E6 evidence pack and E4 collector artifacts exist", () => {
  const e6 = readFileSync(
    join(repoRoot, "docs/coach/ncaaf-e6-signoff-evidence.md"),
    "utf8",
  );
  assert.match(e6, /COMPUTED_NO_PASS_LABEL|no PASS label/i);
  assert.match(e6, /NCAAF_GAME_LINE_SIM_VALIDATED/);
  assert.match(e6, /false/);
  const manifest = JSON.parse(
    readFileSync(
      join(here, "../test/fixtures/ncaaf-pregame-injury-snapshots/manifest.json"),
      "utf8",
    ),
  ) as { snapshots?: unknown[]; evidenceRequiredBeforeE4Validation?: string[] };
  assert.ok((manifest.snapshots?.length ?? 0) >= 1);
  assert.ok((manifest.evidenceRequiredBeforeE4Validation?.length ?? 0) >= 3);
});

test("Phase E calibration stub refuses empty PASS", async () => {
  const { spawnSync } = await import("node:child_process");
  const stub = join(here, "../scripts/ncaafPhaseECalibrationStub.ts");
  const r = spawnSync(
    process.execPath,
    ["--import", join(here, "register-hooks.mjs"), stub],
    {
      env: { ...process.env, NCAAF_PHASE_E_FIXTURE: "" },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 2, `stderr=${r.stderr}\nstdout=${r.stdout}`);
  assert.match(String(r.stderr) + String(r.stdout), /OPEN/);
});
