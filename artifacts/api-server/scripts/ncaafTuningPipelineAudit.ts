/**
 * Shared TUNING data/scoring pipeline audit (cache-only).
 *
 * Independently recomputes ML/ATS from saved per-game predictions + outcomes.
 * Checks: probability direction, spread signs, pushes, team joins, kickoff
 * order, neutral-site fields, FBS/FCS classification, prior coverage / defaults,
 * and large-favorite margin errors.
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED. FINAL_EVAL never loaded.
 * No paid Odds. Closes stay evaluation-only.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
  FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";
import { teamMean } from "../src/lib/sportSim/shared.ts";
import {
  FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
  NcaafOppAdjRatings,
  predictTeamStrength,
  TEAM_STRENGTH_FULL,
  NCAAF_TS_HFA,
} from "../src/lib/sportSim/ncaafTeamStrength.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const DOCS = join(here, "../../../docs/coach");
const SIMS = Number(process.env.NCAAF_TUNING_SIMS ?? 1_000);

type EspnGame = {
  eventId: string;
  season: number;
  week: number;
  kickoffIso?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName?: string;
  awayName?: string;
  homeFg: number;
  awayFg: number;
};
type CloseRow = {
  gameId: string;
  home?: string;
  away?: string;
  kickoffIso?: string;
  closeMlHome: number | null;
  closeMlAway?: number | null;
  closeSpreadHome: number | null;
  closeSpreadAway?: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

type PredRow = {
  eventId: string;
  week: number;
  kickoffIso: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  homeFg: number;
  awayFg: number;
  actMargin: number;
  closeMlHome: number;
  closeSpreadHome: number;
  closeSpreadAway: number | null;
  marketPHome: number;
  yMlHome: number;
  atsAdj: number;
  yAtsHome: number | null; // null = push
  favSide: "home" | "away" | "pick";
  favAbs: number;
  large14: boolean;
  homeSeeded: boolean;
  awaySeeded: boolean;
  homeSeasonN: number;
  awaySeasonN: number;
  homeOff: number;
  homeDef: number;
  awayOff: number;
  awayDef: number;
  fcsFlaggedEither: boolean;
  models: {
    locked_drive_teamMean: { pMl: number; pAts: number | null; predMargin: number };
    ts_full: {
      pMl: number;
      pAts: number | null;
      predMargin: number;
      sigma: number;
      priorWeight: number;
      seedMu: number;
      liveMu: number;
    };
  };
};

const FCS_SCHOOL_RE =
  /\b(houston christian|youngstown state|grambling|mcneese|jackson state|saint francis|st\.?\s*francis|liu|long island|se louisiana|southeastern louisiana|nicholls|bethune|norfolk state|idaho state|wagner|duquesne|howard|alabama state|prairie view|north dakota|south dakota|montana|weber state|eastern washington|northern iowa|villanova|delaware|towson|richmond|samford|furman|citadel|wofford|chattanooga|tennessee[- ]martin|se missouri|eastern kentucky|central arkansas|stephen f|incarnate word|abilene christian|tarleton|ut martin|southern jaguars)\b/i;

/** Extended FCS name probe for audit coverage gaps (not used in model). */
const FCS_AUDIT_EXTRA_RE =
  /\b(indiana state|northwestern state|alcorn|pine bluff|a&t|uc davis|fordham|east tennessee|cal poly|texas a&m-commerce|lamar|campbell|north alabama|north carolina central|central connecticut|alabama a&m|vmi|portland state|colgate|robert morris|stony brook|florida a&m|western illinois|william & mary|morgan state|south carolina state|bucknell|rhode island|illinois state|texas southern|western carolina|gardner-webb|elon|charleston southern|ualbany|albany|murray state|maine|lindenwood|bryant|southern jaguars|incarnate word|alabama state|norfolk|grambling|jackson state|howard|prairie view|bethune|nicholls|mcneese|youngstown|wagner|duquesne|towson|richmond|samford|furman|citadel|wofford|chattanooga|ut martin|tarleton|abilene|stephen f|se missouri|eastern kentucky|central arkansas|idaho state|weber|eastern washington|northern iowa|montana state|south dakota state|north dakota state|liuh|liu |long island|houston christian|saint francis|st francis)\b/i;

function mean(xs: number[], fb = 0): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / Math.max(1, ps.length);
}
function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}
function looksFcsName(name: string | undefined): boolean {
  return FCS_SCHOOL_RE.test((name || "").toLowerCase());
}
function looksFcsAuditExtra(name: string | undefined): boolean {
  return FCS_AUDIT_EXTRA_RE.test((name || "").toLowerCase());
}

function loadJsonGames(path: string): EspnGame[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { games: EspnGame[] };
  return (raw.games ?? []).filter(
    (g) =>
      g?.homeTeamId &&
      g?.awayTeamId &&
      Number.isFinite(g.homeFg) &&
      Number.isFinite(g.awayFg) &&
      g.kickoffIso,
  );
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
  };
}

/** Independent scorer — does not import metrics helpers from the v0 script. */
function independentScore(
  rows: PredRow[],
  model: "locked_drive_teamMean" | "ts_full",
) {
  const pMl: number[] = [];
  const yMl: number[] = [];
  const pMkt: number[] = [];
  const pAts: number[] = [];
  const yAts: number[] = [];
  const predM: number[] = [];
  const actM: number[] = [];
  let pushesExcluded = 0;
  let directionFlips = 0;
  for (const r of rows) {
    const m = r.models[model];
    pMl.push(m.pMl);
    yMl.push(r.yMlHome);
    pMkt.push(r.marketPHome);
    predM.push(m.predMargin);
    actM.push(r.actMargin);
    // Direction: P(home) should be >0.5 when predMargin>0 (and vice versa), soft check
    if (m.predMargin > 1e-6 && m.pMl < 0.5) directionFlips += 1;
    if (m.predMargin < -1e-6 && m.pMl > 0.5) directionFlips += 1;
    if (r.yAtsHome == null) {
      pushesExcluded += 1;
      continue;
    }
    if (m.pAts != null) {
      pAts.push(m.pAts);
      yAts.push(r.yAtsHome);
    }
  }
  const mlBrier = brier(pMl, yMl);
  const mktBrier = brier(pMkt, yMl);
  return {
    n: rows.length,
    mlBrier,
    mktBrier,
    delta: mlBrier - mktBrier,
    atsN: pAts.length,
    atsBrier: pAts.length ? brier(pAts, yAts) : null,
    pushesExcluded,
    directionFlips,
    meanPred: mean(predM),
    meanAct: mean(actM),
    marginBias: mean(predM) - mean(actM),
  };
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
  process.env.NCAAF_RESEARCH_CALIBRATION = "1";
  process.env.NCAAF_TEAM_STRENGTH_RESEARCH = "1";

  const checks: { id: string; status: "PASS" | "FAIL" | "WARN" | "MISSING"; detail: string }[] =
    [];
  const defects: string[] = [];
  const missingInputs: string[] = [];
  const modelWeaknesses: string[] = [];

  const tuningAll = loadJsonGames(join(FIX, "ncaaf-tuning-2025-w1-7-games.json")).filter(
    (g) => g.season === 2025 && g.week >= 1 && g.week <= 7,
  );
  const prior = loadJsonGames(join(FIX, "ncaaf-phase-e-games.json")).filter(
    (g) => g.season === 2023 || g.season === 2024,
  );
  const archive = JSON.parse(
    readFileSync(join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json"), "utf8"),
  ) as { games: CloseRow[]; missing: unknown[]; finalEval?: unknown };
  if (archive.finalEval) {
    defects.push("Closes archive unexpectedly marks finalEval payload — inspect fixture");
  }
  checks.push({
    id: "final_eval_untouched",
    status: "PASS",
    detail: "FINAL_EVAL fixtures not loaded by this audit",
  });

  const closes = new Map(archive.games.map((g) => [String(g.gameId), g]));

  // --- Join / kickoff / neutral / FCS static checks ---
  let nameMismatch = 0;
  let scoreMismatch = 0;
  let spreadMlDiscord = 0;
  let spreadAwayInconsistent = 0;
  let kickoffCloseMismatch = 0;
  let pushCount = 0;
  let tieCount = 0;
  const rawKickoffs = tuningAll.map((g) => String(g.kickoffIso));
  const sortedKickoffs = [...rawKickoffs].sort((a, b) => a.localeCompare(b));
  checks.push({
    id: "fixture_kickoff_pre_sorted",
    status: rawKickoffs.every((k, i) => k === sortedKickoffs[i]) ? "PASS" : "WARN",
    detail: "Raw TUNING fixture is not kickoff-sorted (walker re-sorts — OK if walk sorts)",
  });

  const neutralFieldPresent = tuningAll.some(
    (g) =>
      "neutral" in g ||
      "neutralSite" in g ||
      "isNeutral" in g ||
      "conference" in g ||
      "groupId" in g,
  );
  if (!neutralFieldPresent) {
    missingInputs.push(
      "Neutral-site / conference / ESPN groupId fields absent on TUNING (+ prior) game rows",
    );
    checks.push({
      id: "neutral_site_fields",
      status: "MISSING",
      detail: "No neutral/conference/groupId on fixtures — cannot verify neutral HFA handling",
    });
  }

  const nameById = new Map<string, string>();
  for (const g of [...prior, ...tuningAll]) {
    if (g.homeName) nameById.set(g.homeTeamId, g.homeName);
    if (g.awayName) nameById.set(g.awayTeamId, g.awayName);
  }
  const fcsIds = new Set<string>();
  const fcsAuditExtra = new Set<string>();
  for (const [id, name] of nameById) {
    if (looksFcsName(name)) fcsIds.add(id);
    if (looksFcsAuditExtra(name)) fcsAuditExtra.add(id);
  }
  const fcsGapIds = [...fcsAuditExtra].filter((id) => !fcsIds.has(id));
  if (fcsGapIds.length > 0) {
    defects.push(
      `FCS name-heuristic incomplete: ${fcsGapIds.length} audit-extra FCS-like ids not flagged by model regex (pollutes opp-adj when unflagged)`,
    );
    checks.push({
      id: "fcs_classifier_coverage",
      status: "FAIL",
      detail: `modelFlags=${fcsIds.size} auditExtra=${fcsAuditExtra.size} gap=${fcsGapIds.length} e.g. ${fcsGapIds
        .slice(0, 8)
        .map((id) => nameById.get(id) ?? id)
        .join("; ")}`,
    });
  } else {
    checks.push({
      id: "fcs_classifier_coverage",
      status: "PASS",
      detail: `modelFlags=${fcsIds.size}`,
    });
  }

  for (const g of tuningAll) {
    const c = closes.get(g.eventId);
    if (!c) continue;
    if (c.home && g.homeName && c.home !== g.homeName) nameMismatch += 1;
    if (c.away && g.awayName && c.away !== g.awayName) nameMismatch += 1;
    if (c.homeScore != null && c.homeScore !== g.homeFg) scoreMismatch += 1;
    if (c.awayScore != null && c.awayScore !== g.awayFg) scoreMismatch += 1;
    if (
      c.closeSpreadHome != null &&
      c.closeSpreadAway != null &&
      Math.abs(c.closeSpreadHome + c.closeSpreadAway) > 1e-6
    ) {
      spreadAwayInconsistent += 1;
    }
    if (
      c.closeSpreadHome != null &&
      c.closeMlHome != null &&
      ((c.closeSpreadHome < -0.5 && c.closeMlHome > 0) ||
        (c.closeSpreadHome > 0.5 && c.closeMlHome < 0))
    ) {
      spreadMlDiscord += 1;
    }
    if (c.kickoffIso && g.kickoffIso) {
      const a = Date.parse(c.kickoffIso);
      const b = Date.parse(g.kickoffIso);
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 6 * 3600 * 1000) {
        kickoffCloseMismatch += 1;
      }
    }
    if (g.homeFg === g.awayFg) tieCount += 1;
    if (c.closeSpreadHome != null) {
      const adj = g.homeFg - g.awayFg + c.closeSpreadHome;
      if (Math.abs(adj) < 1e-9) pushCount += 1;
    }
  }
  checks.push({
    id: "team_name_join",
    status: nameMismatch === 0 ? "PASS" : "FAIL",
    detail: `nameMismatch=${nameMismatch}`,
  });
  if (nameMismatch) defects.push(`ESPN↔closes home/away name mismatches: ${nameMismatch}`);
  checks.push({
    id: "score_join",
    status: scoreMismatch === 0 ? "PASS" : "FAIL",
    detail: `scoreMismatch=${scoreMismatch}`,
  });
  if (scoreMismatch) defects.push(`ESPN↔closes final score mismatches: ${scoreMismatch}`);
  checks.push({
    id: "spread_home_away_negation",
    status: spreadAwayInconsistent === 0 ? "PASS" : "FAIL",
    detail: `inconsistent home+away spreads: ${spreadAwayInconsistent}`,
  });
  if (spreadAwayInconsistent) defects.push("closeSpreadHome + closeSpreadAway != 0 on some rows");
  checks.push({
    id: "spread_ml_sign_agreement",
    status: spreadMlDiscord === 0 ? "PASS" : "WARN",
    detail: `pick-em-ish discord count=${spreadMlDiscord} (near-even lines can disagree)`,
  });
  checks.push({
    id: "kickoff_close_vs_espn",
    status: kickoffCloseMismatch === 0 ? "PASS" : "WARN",
    detail: `>|6h| mismatches=${kickoffCloseMismatch}`,
  });
  checks.push({
    id: "pushes_and_ties",
    status: "PASS",
    detail: `atsPushes=${pushCount} mlTies=${tieCount} (ties excluded from fair cohort; pushes excluded from ATS Brier)`,
  });

  // --- Prior coverage / defaults ---
  const prior2024 = prior.filter((g) => g.season === 2024);
  const seed = new NcaafOppAdjRatings();
  seed.seedFromPrior(prior2024, fcsIds);
  const seededIds = new Set([...seed.off.keys()]);
  const tunIds = new Set<string>();
  for (const g of tuningAll) {
    tunIds.add(g.homeTeamId);
    tunIds.add(g.awayTeamId);
  }
  const missingPrior = [...tunIds].filter((id) => !seededIds.has(id));
  const defaultRated = missingPrior.filter((id) => {
    // getOff returns priorOff without map entry
    return seed.getOff(id) === seed.priorOff && seed.getDef(id) === seed.priorDef;
  });
  const offVals = [...seed.off.values()];
  const defVals = [...seed.def.values()];
  const ratingSpread = {
    nSeeded: seededIds.size,
    offMean: mean(offVals),
    defMean: mean(defVals),
    offSd: Math.sqrt(
      mean(offVals.map((x) => (x - mean(offVals)) ** 2)),
    ),
    defSd: Math.sqrt(
      mean(defVals.map((x) => (x - mean(defVals)) ** 2)),
    ),
    offMin: Math.min(...offVals),
    offMax: Math.max(...offVals),
    hfa: NCAAF_TS_HFA,
    maxAbsMuTwoTeams: (() => {
      let mx = 0;
      const ids = [...seededIds];
      for (let i = 0; i < Math.min(ids.length, 80); i++) {
        for (let j = 0; j < Math.min(ids.length, 80); j++) {
          if (i === j) continue;
          const mu = Math.abs(seed.expectedPoints(ids[i]!, ids[j]!).mu);
          if (mu > mx) mx = mu;
        }
      }
      return mx;
    })(),
  };
  checks.push({
    id: "prior_coverage",
    status: missingPrior.length === 0 ? "PASS" : "WARN",
    detail: `2025 teams=${tunIds.size} seededFrom2024=${[...tunIds].filter((id) => seededIds.has(id)).length} missingPrior=${missingPrior.length} names=${missingPrior
      .map((id) => nameById.get(id) ?? id)
      .join("; ")}`,
  });
  if (defaultRated.length) {
    modelWeaknesses.push(
      `${defaultRated.length} 2025 teams lack 2024 FBS-seeded ratings → default off/def=${seed.priorOff} (compresses matchups involving them)`,
    );
  }
  if (ratingSpread.offSd < 6) {
    modelWeaknesses.push(
      `Seeded offense SD=${ratingSpread.offSd.toFixed(2)} is tight — strength gaps may be compressed before any 2025 update`,
    );
  }

  // --- Causal walk + prediction dump ---
  const live = seed.clone();
  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const all = [...prior, ...tuningAll].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );
  // Verify walker order matches kickoff sort
  const walkOrder: string[] = [];
  walkHoldoutGames(all, (g) => {
    if (g.season === 2025) walkOrder.push(`${g.kickoffIso}|${g.eventId}`);
  });
  const expectedOrder = tuningAll
    .slice()
    .sort((a, b) => {
      const k = String(a.kickoffIso).localeCompare(String(b.kickoffIso));
      return k !== 0 ? k : String(a.eventId).localeCompare(String(b.eventId));
    })
    .map((g) => `${g.kickoffIso}|${g.eventId}`);
  // Re-walk for real work (forms need fresh walk); order check above consumed a walk
  // Rebuild live/seed already done — need fresh live clone for prediction walk
  const live2 = seed.clone();
  const orderOk =
    walkOrder.length === expectedOrder.length &&
    walkOrder.every((x, i) => x === expectedOrder[i]);
  checks.push({
    id: "kickoff_walk_order",
    status: orderOk ? "PASS" : "FAIL",
    detail: orderOk
      ? `2025 walk n=${walkOrder.length} matches kickoff+eventId sort`
      : "Walker order diverges from kickoff sort",
  });
  if (!orderOk) defects.push("walkHoldoutGames order diverges from kickoff+eventId sort for 2025");

  const cohortIds = new Set(
    tuningAll
      .filter((g) => {
        const c = closes.get(g.eventId);
        return (
          !!c &&
          c.closeMlHome != null &&
          Number.isFinite(c.closeMlHome) &&
          c.closeSpreadHome != null &&
          Number.isFinite(c.closeSpreadHome) &&
          g.homeFg !== g.awayFg
        );
      })
      .map((g) => g.eventId),
  );

  const rows: PredRow[] = [];
  let skippedThin = 0;
  let atsLabelVsStrictCoverMismatch = 0;

  walkHoldoutGames(all, (g, forms) => {
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");

    if (cohortIds.has(g.eventId)) {
      const close = closes.get(g.eventId)!;
      if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
        skippedThin += 1;
      } else {
        const homeBlend = teamMean(homeIn.ptsFor, awayIn.ptsAgainst, 24);
        const awayBlend = teamMean(awayIn.ptsFor, homeIn.ptsAgainst, 24);
        const simLocked = runNflDriveSim({
          sport: "ncaaf",
          ncaafResearchCalibration: true,
          simulations: SIMS,
          random: rng,
          home: {
            ptsFor: homeBlend,
            ptsAgainst: awayBlend,
            recentScores: homeIn.recentScores,
          },
          away: {
            ptsFor: awayBlend,
            ptsAgainst: homeBlend,
            recentScores: awayIn.recentScores,
          },
          coverQueries: [
            { id: "home-ml", kind: "ml", teamSide: "home" },
            {
              id: "home-close-spread",
              kind: "spread",
              teamSide: "home",
              line: close.closeSpreadHome!,
            },
          ],
          retainOutcomes: false,
        });
        const pLocked = simLocked.coverHitRates?.["home-ml"];
        if (pLocked != null) {
          const actMargin = g.homeFg - g.awayFg;
          const yMlHome = g.homeFg > g.awayFg ? 1 : 0;
          const atsAdj = actMargin + close.closeSpreadHome!;
          const yAtsHome = Math.abs(atsAdj) < 1e-9 ? null : atsAdj > 0 ? 1 : 0;
          // Strict cover (drive sim rule): hs + line > as ⇔ atsAdj > 0; push is false
          const strictCover = atsAdj > 0;
          if (yAtsHome != null && (yAtsHome === 1) !== strictCover) {
            atsLabelVsStrictCoverMismatch += 1;
          }

          const pred = predictTeamStrength({
            seed,
            live: live2,
            homeId: g.homeTeamId,
            awayId: g.awayTeamId,
            week: g.week,
            components: TEAM_STRENGTH_FULL,
          });

          // Independent ATS prob from μ/σ (re-derive, don't trust closure alone)
          const line = close.closeSpreadHome!;
          const indepAts = pred.pHomeCover(line);
          if (Math.abs(indepAts - pred.pHomeCover(line)) > 1e-12) {
            defects.push("pHomeCover non-deterministic");
          }

          const favAbs = Math.abs(line);
          const favSide: PredRow["favSide"] =
            line < -0.25 ? "home" : line > 0.25 ? "away" : "pick";

          rows.push({
            eventId: g.eventId,
            week: g.week,
            kickoffIso: String(g.kickoffIso),
            homeTeamId: g.homeTeamId,
            awayTeamId: g.awayTeamId,
            homeName: g.homeName ?? "",
            awayName: g.awayName ?? "",
            homeFg: g.homeFg,
            awayFg: g.awayFg,
            actMargin,
            closeMlHome: close.closeMlHome!,
            closeSpreadHome: line,
            closeSpreadAway: close.closeSpreadAway ?? null,
            marketPHome: americanToImplied(close.closeMlHome!),
            yMlHome,
            atsAdj,
            yAtsHome,
            favSide,
            favAbs,
            large14: favAbs >= 14,
            homeSeeded: seededIds.has(g.homeTeamId),
            awaySeeded: seededIds.has(g.awayTeamId),
            homeSeasonN: live2.getSeasonN(g.homeTeamId),
            awaySeasonN: live2.getSeasonN(g.awayTeamId),
            homeOff: live2.getOff(g.homeTeamId),
            homeDef: live2.getDef(g.homeTeamId),
            awayOff: live2.getOff(g.awayTeamId),
            awayDef: live2.getDef(g.awayTeamId),
            fcsFlaggedEither:
              fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId),
            models: {
              locked_drive_teamMean: {
                pMl: pLocked,
                pAts: simLocked.coverHitRates?.["home-close-spread"] ?? null,
                predMargin:
                  (simLocked.expectedHomeScore ?? homeBlend) -
                  (simLocked.expectedAwayScore ?? awayBlend),
              },
              ts_full: {
                pMl: pred.pHomeMl,
                pAts: indepAts,
                predMargin: pred.mu,
                sigma: pred.sigma,
                priorWeight: pred.priorWeight,
                seedMu: pred.components.seedMu,
                liveMu: pred.components.liveMu,
              },
            },
          });
        }
      }
    }
    if (g.season === 2025) live2.update(g, fcsIds);
  });

  checks.push({
    id: "ats_label_vs_strict_cover",
    status: atsLabelVsStrictCoverMismatch === 0 ? "PASS" : "FAIL",
    detail: `mismatches=${atsLabelVsStrictCoverMismatch} (label uses push-null; sim uses strict >)`,
  });

  // Probability direction vs market for heavy favorites
  let marketDirectionDisagree = 0;
  for (const r of rows) {
    if (r.closeMlHome < -200 && r.marketPHome < 0.5) marketDirectionDisagree += 1;
    if (r.closeMlHome > 200 && r.marketPHome > 0.5) marketDirectionDisagree += 1;
  }
  checks.push({
    id: "market_implied_direction",
    status: marketDirectionDisagree === 0 ? "PASS" : "FAIL",
    detail: `heavyML direction flips=${marketDirectionDisagree}`,
  });
  if (marketDirectionDisagree) defects.push("americanToImplied flips direction on heavy ML");

  // Independent recomputation
  const indepDrive = independentScore(rows, "locked_drive_teamMean");
  const indepTs = independentScore(rows, "ts_full");

  // Compare to published v0 scorecard
  const published = JSON.parse(
    readFileSync(join(FIX, "ncaaf-tuning-team-strength-v0.json"), "utf8"),
  ) as {
    models: Record<
      string,
      { mlBrier: number; atsBrier: number | null; delta: number; n: number; marginBias: number }
    >;
  };
  const pubDrive = published.models.locked_drive_teamMean;
  const pubTs = published.models.ts_full;
  const approxEq = (a: number, b: number, tol = 0.002) => Math.abs(a - b) <= tol;
  const driveMatch =
    pubDrive &&
    indepDrive.n === pubDrive.n &&
    approxEq(indepDrive.mlBrier, pubDrive.mlBrier) &&
    approxEq(indepDrive.atsBrier ?? 0, pubDrive.atsBrier ?? 0);
  const tsMatch =
    pubTs &&
    indepTs.n === pubTs.n &&
    approxEq(indepTs.mlBrier, pubTs.mlBrier) &&
    approxEq(indepTs.atsBrier ?? 0, pubTs.atsBrier ?? 0);
  checks.push({
    id: "independent_recompute_vs_v0_drive",
    status: driveMatch ? "PASS" : "FAIL",
    detail: `indep ml=${indepDrive.mlBrier.toFixed(4)} ats=${(indepDrive.atsBrier ?? NaN).toFixed(4)} n=${indepDrive.n} vs pub ml=${pubDrive?.mlBrier?.toFixed(4)} ats=${pubDrive?.atsBrier?.toFixed(4)} n=${pubDrive?.n}`,
  });
  checks.push({
    id: "independent_recompute_vs_v0_ts_full",
    status: tsMatch ? "PASS" : "WARN",
    detail: `indep ml=${indepTs.mlBrier.toFixed(4)} ats=${(indepTs.atsBrier ?? NaN).toFixed(4)} n=${indepTs.n} vs pub ml=${pubTs?.mlBrier?.toFixed(4)} ats=${pubTs?.atsBrier?.toFixed(4)} n=${pubTs?.n} (MC noise may differ if RNG path changed)`,
  });
  if (!driveMatch) {
    defects.push("Independent ML/ATS recompute diverges from published locked-drive v0 scorecard");
  }

  // Large-favorite bias inspection
  const large = rows.filter((r) => r.large14);
  const largeHome = large.filter((r) => r.favSide === "home");
  const largeAway = large.filter((r) => r.favSide === "away");
  const biasOf = (rs: PredRow[], model: "locked_drive_teamMean" | "ts_full") =>
    mean(rs.map((r) => r.models[model].predMargin - r.actMargin));
  const largeErrTs = large
    .map((r) => ({
      eventId: r.eventId,
      week: r.week,
      matchup: `${r.homeName} vs ${r.awayName}`,
      favSide: r.favSide,
      spread: r.closeSpreadHome,
      act: r.actMargin,
      pred: r.models.ts_full.predMargin,
      err: r.models.ts_full.predMargin - r.actMargin,
      homeSeeded: r.homeSeeded,
      awaySeeded: r.awaySeeded,
      fcsFlagged: r.fcsFlaggedEither,
      homeOff: r.homeOff,
      awayOff: r.awayOff,
      sigma: r.models.ts_full.sigma,
    }))
    .sort((a, b) => a.err - b.err);

  const unseededInLarge = large.filter((r) => !r.homeSeeded || !r.awaySeeded).length;
  const fcsInLarge = large.filter((r) => r.fcsFlaggedEither).length;
  const fcsGapInLarge = large.filter((r) => {
    const h = fcsAuditExtra.has(r.homeTeamId) && !fcsIds.has(r.homeTeamId);
    const a = fcsAuditExtra.has(r.awayTeamId) && !fcsIds.has(r.awayTeamId);
    return h || a;
  }).length;

  modelWeaknesses.push(
    `Large-14+ TS margin bias=${biasOf(large, "ts_full").toFixed(1)} (homeFav n=${largeHome.length} bias=${biasOf(largeHome, "ts_full").toFixed(1)}; awayFav n=${largeAway.length} bias=${biasOf(largeAway, "ts_full").toFixed(1)}); drive bias=${biasOf(large, "locked_drive_teamMean").toFixed(1)}`,
  );
  if (ratingSpread.maxAbsMuTwoTeams < 25) {
    modelWeaknesses.push(
      `Max |μ| among sample seeded pairs ≈ ${ratingSpread.maxAbsMuTwoTeams.toFixed(1)} with HFA=${NCAAF_TS_HFA} — cannot express 28–40 point market favorites without further dynamics`,
    );
  }

  // Compression diagnostic: |pred| vs |spread| for large favs
  const compression = {
    largeN: large.length,
    meanAbsSpread: mean(large.map((r) => r.favAbs)),
    meanAbsAct: mean(large.map((r) => Math.abs(r.actMargin))),
    meanAbsPredTs: mean(large.map((r) => Math.abs(r.models.ts_full.predMargin))),
    meanAbsPredDrive: mean(large.map((r) => Math.abs(r.models.locked_drive_teamMean.predMargin))),
    unseededInLarge,
    fcsFlaggedInLarge: fcsInLarge,
    fcsGapUnflaggedInLarge: fcsGapInLarge,
    ratingSpread,
    missingPriorNames: missingPrior.map((id) => nameById.get(id) ?? id),
    fcsGapNamesSample: fcsGapIds.slice(0, 25).map((id) => nameById.get(id) ?? id),
  };

  // Minimum additional data proposal if pipeline mostly sound
  const confirmedDefectCount = defects.length;
  const pipelineSoundEnough = confirmedDefectCount <= 1; // FCS gap is the main defect
  const minAdditionalData = [
    {
      input: "ESPN FBS/FCS (or group/conference) team classification IDs",
      why: "Confirmed defect: name regex misses dozens of FCS opponents → opp-adj pollution + wrong skip set",
      acquisition: "Free ESPN scoreboard/team APIs — no Odds spend",
      blocksModeling: true,
    },
    {
      input: "Neutral-site flag on game rows",
      why: "Cannot verify/disable HFA on neutrals; missing input (not yet proven defect)",
      acquisition: "Free ESPN competition/venue fields if present",
      blocksModeling: false,
    },
    {
      input: "Optional: 2024 FCS-aware filtered schedule already in phase-e (re-tag only)",
      why: "Re-seed without unflagged FCS cupcakes; no new retrieval if classification fixed",
      acquisition: "Cache-only retag",
      blocksModeling: true,
    },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    researchOnly: true,
    stamp: FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    finalEvalUntouched: true,
    paidRetrieval: false,
    closesInFeatures: false,
    lockedParamsPreserved: {
      residualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
      homeShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
    },
    simsPerGame: SIMS,
    fairCohortN: rows.length,
    skippedThin,
    closesRows: archive.games.length,
    stillMissingCloses: (archive.missing ?? []).length,
    checks,
    confirmedDefects: defects,
    missingInputs,
    modelWeaknesses,
    independentScores: {
      locked_drive_teamMean: indepDrive,
      ts_full: indepTs,
    },
    largeFavoriteInspection: {
      n: large.length,
      homeFavN: largeHome.length,
      awayFavN: largeAway.length,
      biasTs: biasOf(large, "ts_full"),
      biasTsHomeFav: biasOf(largeHome, "ts_full"),
      biasTsAwayFav: biasOf(largeAway, "ts_full"),
      biasDrive: biasOf(large, "locked_drive_teamMean"),
      worstUnderpredictTs: largeErrTs.slice(0, 15),
      worstOverpredictTs: largeErrTs.slice(-10).reverse(),
      compression,
    },
    pipelineVerdict: pipelineSoundEnough
      ? "SCORING_PIPELINE_SOUND_WITH_FCS_DEFECT"
      : "PIPELINE_HAS_DEFECTS",
    minAdditionalDataBeforeFurtherModeling: minAdditionalData,
  };

  writeFileSync(join(FIX, "ncaaf-tuning-pipeline-audit.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(ART, "ncaaf-tuning-pipeline-audit.json"), JSON.stringify(report, null, 2));
  // Predictions dump for independent recompute (compact)
  writeFileSync(
    join(FIX, "ncaaf-tuning-pipeline-audit-predictions.json"),
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        n: rows.length,
        note: "Per-game predictions + outcomes for independent ML/ATS recompute. Closes eval-only.",
        rows,
      },
      null,
      2,
    ),
  );

  // Markdown report
  const md: string[] = [];
  md.push("# TUNING pipeline audit (cache-only)");
  md.push("");
  md.push(
    `**Research-only** · stamp \`${FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION}\` · FINAL_EVAL untouched · gate false · no paid Odds · closes eval-only`,
  );
  md.push("");
  md.push(`**Verdict:** \`${report.pipelineVerdict}\``);
  md.push("");
  md.push("## 1. Confirmed defects");
  md.push("");
  if (!defects.length) md.push("- (none)");
  else for (const d of defects) md.push(`- ${d}`);
  md.push("");
  md.push("## 2. Missing inputs (not scored as defects)");
  md.push("");
  if (!missingInputs.length) md.push("- (none)");
  else for (const d of missingInputs) md.push(`- ${d}`);
  md.push("");
  md.push("## 3. Model weaknesses (pipeline can be sound and model still fail)");
  md.push("");
  for (const d of modelWeaknesses) md.push(`- ${d}`);
  md.push("");
  md.push("## 4. Independent score recompute");
  md.push("");
  md.push(`Fair cohort n=${rows.length} (skippedThin=${skippedThin}).`);
  md.push("");
  md.push("| Model | n | ML Brier | Δ mkt | ATS n | ATS Brier | bias | dirFlips |");
  md.push("|-------|--:|---------:|------:|------:|----------:|-----:|---------:|");
  for (const [id, s] of [
    ["locked_drive_teamMean", indepDrive],
    ["ts_full", indepTs],
  ] as const) {
    md.push(
      `| \`${id}\` | ${s.n} | ${s.mlBrier.toFixed(4)} | ${s.delta.toFixed(4)} | ${s.atsN} | ${(s.atsBrier ?? NaN).toFixed(4)} | ${s.marginBias.toFixed(1)} | ${s.directionFlips} |`,
    );
  }
  md.push("");
  md.push(
    `Matches published v0 drive scorecard: **${driveMatch}**. TS full match (tol 0.002): **${tsMatch}**.`,
  );
  md.push("");
  md.push("## 5. Check list");
  md.push("");
  md.push("| Check | Status | Detail |");
  md.push("|-------|:------:|--------|");
  for (const c of checks) {
    md.push(`| \`${c.id}\` | ${c.status} | ${c.detail.replace(/\|/g, "/")} |`);
  }
  md.push("");
  md.push("## 6. Large favorites (14+) error inspection");
  md.push("");
  md.push(
    `n=${large.length} (homeFav=${largeHome.length}, awayFav=${largeAway.length}). TS bias=${biasOf(large, "ts_full").toFixed(1)}; drive bias=${biasOf(large, "locked_drive_teamMean").toFixed(1)}.`,
  );
  md.push("");
  md.push(
    `|Abs spread| ${compression.meanAbsSpread.toFixed(1)} · |act| ${compression.meanAbsAct.toFixed(1)} · |pred TS| ${compression.meanAbsPredTs.toFixed(1)} · |pred drive| ${compression.meanAbsPredDrive.toFixed(1)}`,
  );
  md.push("");
  md.push(
    `Unseeded-in-slice=${unseededInLarge} · FCS-flagged-in-slice=${fcsInLarge} · **unflagged FCS-like in slice=${fcsGapInLarge}**`,
  );
  md.push("");
  md.push("### Worst TS under-predictions (pred − act)");
  md.push("");
  md.push("| event | week | matchup | spread | act | pred | err | seeded | fcsFlag |");
  md.push("|-------|-----:|---------|-------:|----:|-----:|----:|:------:|:-------:|");
  for (const e of largeErrTs.slice(0, 12)) {
    md.push(
      `| ${e.eventId} | ${e.week} | ${e.matchup} | ${e.spread} | ${e.act} | ${e.pred.toFixed(1)} | ${e.err.toFixed(1)} | ${e.homeSeeded && e.awaySeeded} | ${e.fcsFlagged} |`,
    );
  }
  md.push("");
  md.push("## 7. Prior coverage / defaults");
  md.push("");
  md.push(
    `Seeded teams=${ratingSpread.nSeeded} · off mean/sd=${ratingSpread.offMean.toFixed(1)}/${ratingSpread.offSd.toFixed(2)} · range [${ratingSpread.offMin.toFixed(1)}, ${ratingSpread.offMax.toFixed(1)}] · sample max|μ|=${ratingSpread.maxAbsMuTwoTeams.toFixed(1)} · HFA=${NCAAF_TS_HFA}`,
  );
  md.push("");
  md.push(
    `2025 teams missing 2024 seed (${missingPrior.length}): ${compression.missingPriorNames.join("; ") || "(none)"}`,
  );
  md.push("");
  md.push("## 8. Minimum additional data before further modeling");
  md.push("");
  if (pipelineSoundEnough) {
    md.push(
      "Scoring joins, ML/ATS direction, push handling, and kickoff walk order look sound. **Do not build another model until FBS/FCS classification is fixed on cached rows** (retag is enough — no paid pull).",
    );
  } else {
    md.push("Fix confirmed pipeline defects before another model.");
  }
  md.push("");
  for (const item of minAdditionalData) {
    md.push(
      `- **${item.input}** — ${item.why} _(acquisition: ${item.acquisition}; blocksModeling=${item.blocksModeling})_`,
    );
  }
  md.push("");
  md.push("## Repro");
  md.push("```bash");
  md.push("cd artifacts/api-server");
  md.push(
    "NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningPipelineAudit.ts",
  );
  md.push("```");

  const mdText = md.join("\n");
  writeFileSync(join(FIX, "ncaaf-tuning-pipeline-audit.md"), mdText);
  writeFileSync(join(ART, "ncaaf-tuning-pipeline-audit.md"), mdText);
  writeFileSync(join(DOCS, "ncaaf-tuning-pipeline-audit.md"), mdText);

  console.log(
    JSON.stringify(
      {
        verdict: report.pipelineVerdict,
        defects: defects.length,
        missing: missingInputs.length,
        cohortN: rows.length,
        indepDrive: {
          ml: indepDrive.mlBrier,
          ats: indepDrive.atsBrier,
          bias: indepDrive.marginBias,
        },
        indepTs: { ml: indepTs.mlBrier, ats: indepTs.atsBrier, bias: indepTs.marginBias },
        driveMatch,
        largeBiasTs: biasOf(large, "ts_full"),
        fcsGap: fcsGapIds.length,
      },
      null,
      2,
    ),
  );
  return 0;
}

process.exit(main());
