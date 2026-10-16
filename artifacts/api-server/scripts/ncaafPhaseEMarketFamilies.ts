/**
 * Phase E — market-family holdout on nfl-drive:ppg-per-drive-v1.
 *
 * Validates spreads, moneylines, supported ALT spreads, and totals against
 * held-out 2024 outcomes with selection-time (pre-kickoff) form only.
 *
 * Closing totals / ALT posted prices are NOT in the E2b archive — those
 * stay INSUFFICIENT_DATA for CLV. Totals here are engine-vs-final calibration.
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_DRIVE_ENGINE_VERSION,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  loadClosingLineArchive,
  loadFootballCompletionStamps,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIMS = Number(process.env.NCAAF_PHASE_E_SIMS ?? 10_000);
const HOLDOUT_SEASON = 2024;
const UNTOUCHED_CUTOFF = process.env.NCAAF_UNTOUCHED_CUTOFF ?? "2024-10-15T00:00:00Z";
const ALT_AWAY_LINES = [3.5, 7.5, 10.5, 14, 17.5, 21] as const;

type EspnGame = {
  eventId: string;
  season: number;
  week: number;
  kickoffIso?: string;
  completedAtIso?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeFg: number;
  awayFg: number;
};

function mean(xs: number[], fb = 0): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function teamSimInput(form: HoldoutWalkForm | undefined, venue: "home" | "away") {
  const l10For = form?.ptsFor.slice(-10) ?? [];
  const l10Against = form?.ptsAgainst.slice(-10) ?? [];
  const venueFor =
    venue === "home" ? form?.homeFor.slice(-10) ?? [] : form?.awayFor.slice(-10) ?? [];
  const venueAgainst =
    venue === "home"
      ? form?.homeAgainst.slice(-10) ?? []
      : form?.awayAgainst.slice(-10) ?? [];
  const l10 = {
    games: l10For.length,
    ptsFor: l10For.length >= 2 ? mean(l10For, 24) : null,
    ptsAgainst: l10Against.length >= 2 ? mean(l10Against, 24) : null,
  };
  const vs = {
    games: venueFor.length,
    ptsFor: venueFor.length ? mean(venueFor, 24) : null,
    ptsAgainst: venueAgainst.length ? mean(venueAgainst, 24) : null,
  };
  const blended = blendVenueAndL10(vs, l10);
  return {
    ptsFor: blended.ptsFor,
    ptsAgainst: blended.ptsAgainst,
    recentScores: l10For.slice(),
    provenance: blended.provenance,
  };
}

function loadGames(): EspnGame[] {
  const fixture = join(here, "../test/fixtures/ncaaf-phase-e-games.json");
  const raw = JSON.parse(readFileSync(fixture, "utf8")) as { games: EspnGame[] };
  const stamps = loadFootballCompletionStamps(
    join(here, "../test/fixtures/football-completion-timestamps.json"),
  );
  return (raw.games ?? [])
    .filter(
      (g) =>
        g?.homeTeamId &&
        g?.awayTeamId &&
        Number.isFinite(g.homeFg) &&
        Number.isFinite(g.awayFg),
    )
    .map((g) => ({
      ...g,
      completedAtIso: stamps.get(g.eventId) ?? null,
    }))
    .sort((a, b) => String(a.kickoffIso ?? "").localeCompare(String(b.kickoffIso ?? "")));
}

function main(): number {
  console.log("══ NCAAF Phase E market families (spread/ML/ALT/totals) ══");
  console.log(`engine=nfl-drive:${FOOTBALL_DRIVE_ENGINE_VERSION} sims=${SIMS}`);
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped.");

  const games = loadGames();
  const closingPath = join(here, "../test/fixtures/ncaaf-phase-e-closing-lines.json");
  const closingArchive = loadClosingLineArchive(closingPath);
  const closingByEvent = new Map(
    closingArchive.rows.map((row) => [
      row.eventId,
      { closeSpreadHome: row.closeSpreadHome, closeMlHome: row.closeMlHome },
    ]),
  );

  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  type Series = { p: number[]; y: number[]; mkt?: number[] };
  const emptySeries = (): Series => ({ p: [], y: [], mkt: [] });
  const windows = {
    full: {
      ml: emptySeries(),
      spread: emptySeries(),
      totalAbsErr: [] as number[],
      totalOver: emptySeries(),
    },
    untouched: {
      ml: emptySeries(),
      spread: emptySeries(),
      totalAbsErr: [] as number[],
      totalOver: emptySeries(),
    },
  };
  const alt: Record<
    string,
    { p: number[]; y: number[]; n: number; coverRate: number | null; meanP: number | null; brier: number | null }
  > = {};
  for (const line of ALT_AWAY_LINES) {
    alt[`away_+${line}`] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };
  }
  alt["home_close"] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };
  alt["home_close_plus_3.5"] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };
  alt["home_close_minus_3.5"] = { p: [], y: [], n: 0, coverRate: null, meanP: null, brier: null };

  let scored = 0;
  let skippedThin = 0;
  const cutoffMs = Date.parse(UNTOUCHED_CUTOFF);

  const pushSeries = (
    w: "full" | "untouched",
    kind: "ml" | "spread" | "totalOver",
    p: number,
    y: number,
    mkt?: number | null,
  ) => {
    const series = windows[w][kind === "totalOver" ? "totalOver" : kind];
    series.p.push(p);
    series.y.push(y);
    // Keep mkt aligned 1:1 with p/y (NaN = no close market).
    series.mkt!.push(mkt != null && Number.isFinite(mkt) ? mkt : Number.NaN);
  };

  walkHoldoutGames(games, (g, forms) => {
    if (g.season !== HOLDOUT_SEASON) return;
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
      skippedThin += 1;
      return;
    }
    const close = closingByEvent.get(g.eventId);
    const kickMs = Date.parse(String(g.kickoffIso ?? ""));
    const untouched = Number.isFinite(kickMs) && kickMs >= cutoffMs;
    const coverQueries: Array<{
      id: string;
      kind: "ml" | "spread" | "total";
      teamSide?: "home" | "away";
      line?: number;
      totalSide?: "over" | "under";
    }> = [
      { id: "home-ml", kind: "ml", teamSide: "home" },
      ...ALT_AWAY_LINES.map((line) => ({
        id: `away-alt-${line}`,
        kind: "spread" as const,
        teamSide: "away" as const,
        line,
      })),
    ];
    if (close) {
      coverQueries.push(
        {
          id: "home-close",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome,
        },
        {
          id: "home-close-p35",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome + 3.5,
        },
        {
          id: "home-close-m35",
          kind: "spread",
          teamSide: "home",
          line: close.closeSpreadHome - 3.5,
        },
      );
    }
    // Totals graded at projected mean after first pass — use placeholder then re-score from outcomes
    coverQueries.push({
      id: "over-proj-placeholder",
      kind: "total",
      totalSide: "over",
      line: 50,
    });

    const result = runNflDriveSim({
      sport: "ncaaf",
      simulations: SIMS,
      random: rng,
      home: {
        ptsFor: homeIn.ptsFor,
        ptsAgainst: homeIn.ptsAgainst,
        recentScores: homeIn.recentScores,
      },
      away: {
        ptsFor: awayIn.ptsFor,
        ptsAgainst: awayIn.ptsAgainst,
        recentScores: awayIn.recentScores,
      },
      coverQueries,
      retainOutcomes: false,
    });
    if (!result?.coverHitRates) return;

    const yHome = g.homeFg > g.awayFg ? 1 : g.homeFg < g.awayFg ? 0 : 0.5;
    if (yHome !== 0 && yHome !== 1) return;
    const pHome = result.coverHitRates["home-ml"] ?? result.homeWinProbability;
    const mktMl = close ? (() => {
      const american = close.closeMlHome;
      if (!Number.isFinite(american) || american === 0) return null;
      return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
    })() : null;
    pushSeries("full", "ml", pHome, yHome, mktMl);
    if (untouched) pushSeries("untouched", "ml", pHome, yHome, mktMl);

    const projTotal =
      (result.homeProjectedScore ?? 0) + (result.awayProjectedScore ?? 0);
    const actualTotal = g.homeFg + g.awayFg;
    windows.full.totalAbsErr.push(Math.abs(projTotal - actualTotal));
    if (untouched) windows.untouched.totalAbsErr.push(Math.abs(projTotal - actualTotal));

    // Second sim for over@projected mean (same seed stream continues)
    const totalResult = runNflDriveSim({
      sport: "ncaaf",
      simulations: Math.min(SIMS, 2500),
      random: rng,
      home: {
        ptsFor: homeIn.ptsFor,
        ptsAgainst: homeIn.ptsAgainst,
        recentScores: homeIn.recentScores,
      },
      away: {
        ptsFor: awayIn.ptsFor,
        ptsAgainst: awayIn.ptsAgainst,
        recentScores: awayIn.recentScores,
      },
      coverQueries: [
        {
          id: "over-proj",
          kind: "total",
          totalSide: "over",
          line: Math.round(projTotal * 2) / 2,
        },
      ],
      retainOutcomes: false,
    });
    if (totalResult?.coverHitRates?.["over-proj"] != null) {
      const pOver = totalResult.coverHitRates["over-proj"];
      const yOver = actualTotal > Math.round(projTotal * 2) / 2 ? 1 : 0;
      pushSeries("full", "totalOver", pOver, yOver);
      if (untouched) pushSeries("untouched", "totalOver", pOver, yOver);
    }

    for (const line of ALT_AWAY_LINES) {
      const p = result.coverHitRates[`away-alt-${line}`];
      if (p == null) continue;
      const y = g.awayFg + line > g.homeFg ? 1 : g.awayFg + line < g.homeFg ? 0 : null;
      if (y == null) continue;
      const bucket = alt[`away_+${line}`]!;
      bucket.p.push(p);
      bucket.y.push(y);
    }

    if (close) {
      const margin = g.homeFg - g.awayFg;
      const scoreClose = (id: string, line: number, key: string) => {
        const p = result.coverHitRates?.[id];
        if (p == null) return;
        const adj = margin + line;
        if (Math.abs(adj) < 1e-9) return;
        const y = adj > 0 ? 1 : 0;
        alt[key]!.p.push(p);
        alt[key]!.y.push(y);
        if (key === "home_close") {
          pushSeries("full", "spread", p, y);
          if (untouched) pushSeries("untouched", "spread", p, y);
        }
      };
      scoreClose("home-close", close.closeSpreadHome, "home_close");
      scoreClose("home-close-p35", close.closeSpreadHome + 3.5, "home_close_plus_3.5");
      scoreClose("home-close-m35", close.closeSpreadHome - 3.5, "home_close_minus_3.5");
    }

    scored += 1;
    if (scored % 100 === 0) console.log(`scored ${scored}`);
  });

  for (const bucket of Object.values(alt)) {
    bucket.n = bucket.p.length;
    bucket.coverRate = bucket.y.length ? mean(bucket.y) : null;
    bucket.meanP = bucket.p.length ? mean(bucket.p) : null;
    bucket.brier = bucket.p.length ? brier(bucket.p, bucket.y) : null;
  }

  function summarizeBinary(s: Series, label: string) {
    const n = s.p.length;
    const engineBrier = n ? brier(s.p, s.y) : null;
    const coinBrier = n ? 0.25 : null;
    // Market series is aligned only when every row has a close ML; otherwise
    // score market Brier on the close-joined subset and compare engine on that subset.
    let marketBrier: number | null = null;
    let engineVsMarketBrier: number | null = null;
    let nMarket = 0;
    if (s.mkt && s.mkt.length === n && n > 0) {
      const eng: number[] = [];
      const mkt: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < n; i++) {
        const m = s.mkt[i]!;
        if (!Number.isFinite(m)) continue;
        eng.push(s.p[i]!);
        mkt.push(m);
        ys.push(s.y[i]!);
      }
      nMarket = mkt.length;
      if (nMarket >= 30) {
        marketBrier = brier(mkt, ys);
        engineVsMarketBrier = brier(eng, ys);
      }
    }
    return {
      label,
      n,
      nWithMarket: nMarket,
      brierEngine: engineBrier,
      brierCoin: coinBrier,
      brierMarket: marketBrier,
      beatsCoin: engineBrier != null && coinBrier != null ? engineBrier < coinBrier : null,
      beatsMarket:
        engineVsMarketBrier != null && marketBrier != null
          ? engineVsMarketBrier < marketBrier
          : null,
      meanP: n ? mean(s.p) : null,
      meanY: n ? mean(s.y) : null,
      bias: n ? mean(s.p) - mean(s.y) : null,
      verdict:
        n >= 100 && engineBrier != null && engineBrier < 0.25
          ? "PASS_VS_COIN"
          : n < 100
            ? "INSUFFICIENT_N"
            : "FAIL_VS_COIN",
    };
  }

  const mlFull = summarizeBinary(windows.full.ml, "ml_full_2024");
  const mlUntouched = summarizeBinary(windows.untouched.ml, "ml_untouched_post_cutoff");
  const spFull = summarizeBinary(windows.full.spread, "spread_full_2024");
  const spUntouched = summarizeBinary(windows.untouched.spread, "spread_untouched_post_cutoff");
  // Spreads have no market-implied cover archive — force market fields null with note
  spFull.brierMarket = null;
  spFull.beatsMarket = null;
  spUntouched.brierMarket = null;
  spUntouched.beatsMarket = null;

  const report = {
    generatedAt: new Date().toISOString(),
    engine: `nfl-drive:${FOOTBALL_DRIVE_ENGINE_VERSION}`,
    calibrationSeed: FOOTBALL_CALIBRATION_PRIMARY_SEED,
    simulationsPerGame: SIMS,
    untouchedCutoff: UNTOUCHED_CUTOFF,
    nHoldoutScored: scored,
    nHoldoutSkippedThinForm: skippedThin,
    settlementAuditRef: "ncaaf-phase-e-spread-settlement-audit.json",
    moneyline: {
      full2024: mlFull,
      untouchedHoldout: mlUntouched,
      primaryVerdict: mlUntouched.verdict,
      note: "Market baseline = close-ML implied. Untouched = kickoff ≥ cutoff (disjoint from Coach CLV selection window).",
    },
    closingSpread: {
      full2024: spFull,
      untouchedHoldout: spUntouched,
      primaryVerdict: spUntouched.verdict,
      note:
        "Home ATS at archived closing spread. Settlement audit cleared sign/push/extraction. No closing spread juice in archive — market ATS baseline unavailable; compare to coin only.",
    },
    altSpreads: Object.fromEntries(
      Object.entries(alt).map(([k, v]) => [
        k,
        {
          n: v.n,
          meanP: v.meanP,
          coverRate: v.coverRate,
          brier: v.brier,
          brierCoin: 0.25,
          beatsCoin: v.brier != null ? v.brier < 0.25 : null,
          bias: v.meanP != null && v.coverRate != null ? v.meanP - v.coverRate : null,
        },
      ]),
    ),
    totals: {
      closingTotalsInArchive: false,
      closingTotalsClv: "INSUFFICIENT_DATA",
      note:
        "E2b closing archive has no totals. Engine totals validated vs finals only (MAE + over@projected-mean). No market total baseline.",
      full2024: {
        n: windows.full.totalAbsErr.length,
        maeProjectedVsActual: windows.full.totalAbsErr.length
          ? mean(windows.full.totalAbsErr)
          : null,
        overAtProjectedMean: summarizeBinary(windows.full.totalOver, "totals_over_proj_full"),
      },
      untouchedHoldout: {
        n: windows.untouched.totalAbsErr.length,
        maeProjectedVsActual: windows.untouched.totalAbsErr.length
          ? mean(windows.untouched.totalAbsErr)
          : null,
        overAtProjectedMean: summarizeBinary(
          windows.untouched.totalOver,
          "totals_over_proj_untouched",
        ),
      },
    },
    closingLineArchive: {
      present: closingArchive.present,
      parsedRows: closingArchive.rows.length,
      fields: ["closeSpreadHome", "closeMlHome"],
      missingForValidation: ["closeTotal", "altPostedPrices", "injuryKnown_non_null"],
    },
    perMarketReadiness: {
      moneyline: {
        vsCoin: mlUntouched.beatsCoin,
        vsMarket: mlUntouched.beatsMarket,
        status:
          mlUntouched.verdict === "PASS_VS_COIN"
            ? "CALIBRATION_BEATS_COIN_NOT_MARKET_BLOCKED_BY_CLV_E4_E6"
            : "NOT_READY",
      },
      spreads: {
        vsCoin: spUntouched.beatsCoin,
        vsMarket: null,
        status: "NOT_READY_FAIL_VS_COIN_SETTLEMENT_CLEARED",
      },
      totals: {
        vsCoin: summarizeBinary(windows.untouched.totalOver, "totals_tmp").beatsCoin,
        vsMarket: null,
        status: "NOT_READY_NO_CLOSING_TOTALS",
      },
      alts: {
        vsCoin: null,
        vsMarket: null,
        status: "NOT_READY_NO_POSTED_ALT_PRICES",
      },
      note: "No market enabled solely because another passes. Live gate stays false.",
    },
    verdicts: {
      ML_untouched: mlUntouched.verdict,
      Spread_untouched: spUntouched.verdict,
      ALT: "MEASURED_SYNTHETIC_LINES — no posted ALT CLV archive",
      Totals: "ENGINE_VS_FINAL_ONLY — closing totals INSUFFICIENT_DATA",
      NCAAF_GAME_LINE_SIM_VALIDATED: "false — do not flip",
    },
    keepP0Armed: true,
    flagFlipAllowed: false,
  };

  const outDir = join(here, "../test/fixtures");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "ncaaf-phase-e-market-families-report.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/ncaaf-phase-e-market-families-report.json",
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch {
    /* optional */
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
  return 2;
}

if (!existsSync(join(here, "../test/fixtures/ncaaf-phase-e-games.json"))) {
  console.error("missing games fixture");
  process.exit(2);
}
process.exit(main());
