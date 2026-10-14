/**
 * Phase E2/E4 calibration stub — does NOT lift NCAAF_GAME_LINE_SIM_VALIDATED.
 *
 * Provide a frozen out-of-sample CSV (closing spread/ML + final scores +
 * optional injury-known flag). Until that fixture exists, this exits 2 so CI
 * / operators cannot mistake an empty run for PASS.
 *
 * CSV columns (header required):
 *   gameId,season,home,away,closeSpreadHome,closeMlHome,homeScore,awayScore,injuryKnown
 *
 * Env:
 *   NCAAF_PHASE_E_FIXTURE=/path/to/file.csv
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type Row = {
  gameId: string;
  closeSpreadHome: number;
  closeMlHome: number;
  homeScore: number;
  awayScore: number;
  injuryKnown: boolean;
};

function parseCsv(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const need = [
    "gameId",
    "closeSpreadHome",
    "closeMlHome",
    "homeScore",
    "awayScore",
    "injuryKnown",
  ];
  for (const n of need) {
    if (idx(n) < 0) throw new Error(`CSV missing column: ${n}`);
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return {
      gameId: cols[idx("gameId")],
      closeSpreadHome: Number(cols[idx("closeSpreadHome")]),
      closeMlHome: Number(cols[idx("closeMlHome")]),
      homeScore: Number(cols[idx("homeScore")]),
      awayScore: Number(cols[idx("awayScore")]),
      injuryKnown: String(cols[idx("injuryKnown")]).toLowerCase() === "true",
    };
  });
}

/** Market-implied home win prob from American ML (rough). */
function mlToProb(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

function main(): number {
  const fixture = process.env.NCAAF_PHASE_E_FIXTURE?.trim();
  console.log("══ NCAAF Phase E2/E4 calibration stub ══");
  console.log("Does not flip NCAAF_GAME_LINE_SIM_VALIDATED.");

  if (!fixture) {
    console.error(
      "OPEN: prefer scripts/ncaafPhaseEHoldoutCalibration.ts (ESPN 2023–2024 holdout).",
    );
    console.error(
      "Or set NCAAF_PHASE_E_FIXTURE to a closing-line CSV for E2b/E4. See docs/coach/ncaaf-phase-e-checklist.md.",
    );
    return 2;
  }

  const path = resolve(fixture);
  if (!existsSync(path)) {
    console.error(`Fixture not found: ${path}`);
    return 2;
  }

  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length < 50) {
    console.error(
      `OPEN: need ≥50 games for a meaningful holdout (got ${rows.length}).`,
    );
    return 2;
  }

  // Placeholder metrics — replace with engine sim probs vs close when wiring D/E.
  let brier = 0;
  let dogCover70 = 0;
  let dogCoverN = 0;
  let edgeKnown = 0;
  let edgeUnknown = 0;
  let nKnown = 0;
  let nUnknown = 0;

  for (const r of rows) {
    const marketP = mlToProb(r.closeMlHome);
    const homeWon = r.homeScore > r.awayScore ? 1 : 0;
    brier += (marketP - homeWon) ** 2;

    const margin = r.homeScore - r.awayScore;
    const homeCovered = margin + r.closeSpreadHome > 0;
    // Rough "dog" when home ML is plus-money.
    if (r.closeMlHome > 0) {
      dogCoverN += 1;
      if (homeCovered) dogCover70 += 1;
    }

    // Without engine probs, edge proxy is |marketP - 0.5| — conservatism check
    // compares known vs unknown injury segments once sim edges are wired.
    const absEdgeProxy = Math.abs(marketP - 0.5);
    if (r.injuryKnown) {
      nKnown += 1;
      edgeKnown += absEdgeProxy;
    } else {
      nUnknown += 1;
      edgeUnknown += absEdgeProxy;
    }
  }

  brier /= rows.length;
  const dogCoverRate = dogCoverN ? dogCover70 / dogCoverN : 0;
  const avgKnown = nKnown ? edgeKnown / nKnown : 0;
  const avgUnknown = nUnknown ? edgeUnknown / nUnknown : 0;

  console.log(
    JSON.stringify(
      {
        n: rows.length,
        marketBrier: Number(brier.toFixed(4)),
        homeDogCoverRate: Number(dogCoverRate.toFixed(4)),
        avgAbsEdgeProxyInjuryKnown: Number(avgKnown.toFixed(4)),
        avgAbsEdgeProxyInjuryUnknown: Number(avgUnknown.toFixed(4)),
        note: "Market-baseline placeholders only — wire nfl-drive sim probs before PASS",
      },
      null,
      2,
    ),
  );

  // Hard fail until engine probs replace placeholders (explicit OPEN).
  console.error(
    "OPEN: stub computed market baselines only. Wire candidate engine probs + agreed tolerances, then mark E2/E4 PASS manually.",
  );
  return 2;
}

process.exit(main());
