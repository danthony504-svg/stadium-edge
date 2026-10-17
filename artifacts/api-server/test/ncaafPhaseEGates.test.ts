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
