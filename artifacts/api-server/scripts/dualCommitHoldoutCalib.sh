#!/usr/bin/env bash
# Same fixed-seed 10k harness on tip (≈2c13a3ba ppg conversion) and on
# vendored 013ddb88 engine files. Identical fixtures + form prep.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
SIMS="${NCAAF_PHASE_E_SIMS:-10000}"
export NCAAF_PHASE_E_SIMS="$SIMS"
export NCAAF_PHASE_E_PRIMARY_ONLY="${NCAAF_PHASE_E_PRIMARY_ONLY:-1}"
OLD=013ddb88
CORRECTED_DOC=2c13a3ba77c3d3df9053b968bc463956d69f1d6f
FIXTURE_DIR=artifacts/api-server/test/fixtures
MATCHUP=artifacts/api-server/src/lib/sportSim/footballDriveMatchup.ts
SIM=artifacts/api-server/src/lib/sportSim/nflDriveSim.ts
BACKUP=$(mktemp -d)

cp "$MATCHUP" "$BACKUP/footballDriveMatchup.ts"
cp "$SIM" "$BACKUP/nflDriveSim.ts"

run_harness() {
  local label="$1"
  local out="$FIXTURE_DIR/ncaaf-phase-e-calibration-report-${label}.json"
  echo "=== harness label=$label sims=$SIMS primaryOnly=$NCAAF_PHASE_E_PRIMARY_ONLY ==="
  rm -f "$FIXTURE_DIR/ncaaf-phase-e-calibration-report.json"
  set +e
  (cd artifacts/api-server && node --import ./test/register-hooks.mjs --experimental-strip-types scripts/ncaafPhaseEHoldoutCalibration.ts)
  local rc=$?
  set -e
  if [[ ! -f "$FIXTURE_DIR/ncaaf-phase-e-calibration-report.json" ]]; then
    echo "ERROR: harness did not write report (rc=$rc)" >&2
    return 1
  fi
  local gen engine
  gen=$(python3 -c "import json;print(json.load(open('$FIXTURE_DIR/ncaaf-phase-e-calibration-report.json')).get('generatedAt',''))")
  engine=$(python3 -c "import json;print(json.load(open('$FIXTURE_DIR/ncaaf-phase-e-calibration-report.json')).get('engine',''))")
  echo "harness generatedAt=$gen engine=$engine rc=$rc"
  cp "$FIXTURE_DIR/ncaaf-phase-e-calibration-report.json" "$out"
  echo "wrote $out"
  # Tip PASS-with-P0-armed exits 2; crash/module errors are 1.
  if [[ "$rc" -eq 1 ]]; then
    return 1
  fi
  return 0
}

echo "=== 1) tip engine (ppg-per-drive-v1; conversion matches $CORRECTED_DOC) ==="
run_harness "tip-ppg-v1"

echo "=== 2) vendor 013ddb88 engine + rng patch for fair seed ==="
git show "$OLD:$MATCHUP" > "$MATCHUP"
git show "$OLD:$SIM" > "$SIM"
# Tip harness imports FOOTBALL_DRIVE_ENGINE_VERSION — stub label on legacy file.
# Thread ctx.random into driveOutcome + late-clock rolls (do not bare-replace Math.random).
python3 - <<'PY'
from pathlib import Path
m = Path("artifacts/api-server/src/lib/sportSim/footballDriveMatchup.ts")
ms = m.read_text()
if "FOOTBALL_DRIVE_ENGINE_VERSION" not in ms:
    ms = (
        'export const FOOTBALL_DRIVE_ENGINE_VERSION = "pre-ppg-per-drive-013ddb88";\n'
        + ms
    )
    m.write_text(ms)
    print("stubbed FOOTBALL_DRIVE_ENGINE_VERSION on legacy matchup")
p = Path("artifacts/api-server/src/lib/sportSim/nflDriveSim.ts")
src = p.read_text()
src = src.replace(
    "function driveOutcome(rateInput: number): number {\n  const r = Math.random();",
    "function driveOutcome(rateInput: number, rng: () => number): number {\n  const r = rng();",
)
src = src.replace(
    "const homeScores: number[] = [];\n  const awayScores: number[] = [];",
    "const rng = ctx.random ?? Math.random;\n  const homeScores: number[] = [];\n  const awayScores: number[] = [];",
)
src = src.replace("driveOutcome(homeRate)", "driveOutcome(homeRate, rng)")
src = src.replace("driveOutcome(awayRate)", "driveOutcome(awayRate, rng)")
src = src.replace("Math.random() < lateClockTd", "rng() < lateClockTd")
if "Math.random()" in src:
    raise SystemExit(f"unpatched Math.random remains: {src.count('Math.random()')}")
if "const rng = ctx.random" not in src:
    raise SystemExit("rng binding missing")
p.write_text(src)
print("rng patch applied OK")
PY
# Stale-report guard: delete before each harness so a failed run cannot reuse tip output.
rm -f "$FIXTURE_DIR/ncaaf-phase-e-calibration-report.json"

run_harness "013ddb88-legacy"

echo "=== 3) restore tip engine ==="
cp "$BACKUP/footballDriveMatchup.ts" "$MATCHUP"
cp "$BACKUP/nflDriveSim.ts" "$SIM"
rm -rf "$BACKUP"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path("artifacts/api-server/test/fixtures")
tip = json.loads((root / "ncaaf-phase-e-calibration-report-tip-ppg-v1.json").read_text())
legacy = json.loads((root / "ncaaf-phase-e-calibration-report-013ddb88-legacy.json").read_text())

def slim(r):
    m = r.get("metrics") or {}
    dog = m.get("nearCoinFlipDog75") or {}
    return {
        "engine": r.get("engine"),
        "n": r.get("nHoldoutScored"),
        "sims": r.get("simulationsPerGame"),
        "seed": r.get("calibrationSeed") or (r.get("dogCohortBySeed") or [{}])[0].get("seed"),
        "meanP": m.get("meanP"),
        "meanY": m.get("meanY"),
        "brier": m.get("brier"),
        "dogN": dog.get("n"),
        "dogCover": dog.get("awayCoverRate"),
        "E2": (r.get("verdicts") or {}).get("E2_outcomeVsCoin"),
    }

def num(a, b):
    if a is None or b is None: return None
    return a - b

st = slim(tip); sl = slim(legacy)
compare = {
    "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "correctedDocCommit": "2c13a3ba77c3d3df9053b968bc463956d69f1d6f",
    "legacyCommit": "013ddb88",
    "identicalPrep": "same ncaaf-phase-e-games.json, walkHoldoutGames, blendVenueAndL10, mulberry32 primary seed, NCAAF_PHASE_E_SIMS",
    "tip": st,
    "legacy013": sl,
    "delta": {
        "meanP": num(st["meanP"], sl["meanP"]),
        "meanY": num(st["meanY"], sl["meanY"]),
        "brier": num(st["brier"], sl["brier"]),
        "dogCover": num(st["dogCover"], sl["dogCover"]),
    },
    "explanation": (
        "013ddb88 feeds points-per-game (×0.48 NCAAF) into the per-drive rate map. "
        "Tip/2c13a3ba divides PPG by shared drive count and does not multiply by 0.48. "
        "Legacy Math.random sites were patched to ctx.random so both sides share mulberry32."
    ),
}
path = root / "dual-commit-holdout-compare.json"
path.write_text(json.dumps(compare, indent=2) + "\n")
pathlib.Path("/opt/cursor/artifacts").mkdir(parents=True, exist_ok=True)
pathlib.Path("/opt/cursor/artifacts/dual-commit-holdout-compare.json").write_text(path.read_text())
print(json.dumps(compare, indent=2))
PY
echo "DONE dual-commit holdout"
