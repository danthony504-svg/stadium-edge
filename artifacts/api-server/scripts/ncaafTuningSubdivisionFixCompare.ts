/**
 * Before/after subdivision fix on identical TUNING fair cohort.
 *
 * BEFORE: legacy name-heuristic FCS set (polluted seed/update) — for comparison only.
 * AFTER:  verified season-specific FBS/FCS IDs; chronological FBS–FBS-only rebuild;
 *         unrated sides → explicit TS exclusion (no invented defaults).
 *
 * Drive model unchanged (same locked params). Reports FBS–FBS, FBS–FCS, Week 1,
 * 14+ favorites with sample counts and exclusions.
 *
 * FINAL_EVAL untouched. No paid Odds. Gate stays false. No new model stamp.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
  FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
  FOOTBALL_DRIVE_ENGINE_VERSION,
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
  NCAAF_TS_LR,
  type TeamStrengthGame,
} from "../src/lib/sportSim/ncaafTeamStrength.ts";
import {
  classifyMatchupSubdivision,
  type MatchupSubdivision,
} from "../src/lib/sportSim/ncaafSubdivision.ts";

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
  closeMlHome: number | null;
  closeSpreadHome: number | null;
};

/** Legacy name heuristic — BEFORE arm only (not used after fix). */
const LEGACY_FCS_RE =
  /\b(houston christian|youngstown state|grambling|mcneese|jackson state|saint francis|st\.?\s*francis|liu|long island|se louisiana|southeastern louisiana|nicholls|bethune|norfolk state|idaho state|wagner|duquesne|howard|alabama state|prairie view|north dakota|south dakota|montana|weber state|eastern washington|northern iowa|villanova|delaware|towson|richmond|samford|furman|citadel|wofford|chattanooga|tennessee[- ]martin|se missouri|eastern kentucky|central arkansas|stephen f|incarnate word|abilene christian|tarleton|ut martin|southern jaguars)\b/i;

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
function favSize(abs: number): string {
  if (abs < 3.5) return "pick_em";
  if (abs <= 7.5) return "small_3.5_7.5";
  if (abs <= 14) return "medium_7.5_14";
  return "large_14plus";
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

/** Legacy polluted ratings (name-heuristic) — BEFORE comparison only. */
class LegacyOppAdj {
  off = new Map<string, number>();
  def = new Map<string, number>();
  seasonN = new Map<string, number>();
  priorOff = 24;
  priorDef = 24;
  lr = NCAAF_TS_LR;
  hfa = NCAAF_TS_HFA;
  getOff(id: string) {
    return this.off.get(id) ?? this.priorOff;
  }
  getDef(id: string) {
    return this.def.get(id) ?? this.priorDef;
  }
  getSeasonN(id: string) {
    return this.seasonN.get(id) ?? 0;
  }
  expectedMu(homeId: string, awayId: string) {
    const homeOff = 0.5 * this.getOff(homeId) + 0.5 * this.getDef(awayId) + this.hfa / 2;
    const awayOff = 0.5 * this.getOff(awayId) + 0.5 * this.getDef(homeId) - this.hfa / 2;
    return homeOff - awayOff;
  }
  seedFromPrior(games: EspnGame[], fcsIds: Set<string>) {
    const teams = new Set<string>();
    for (const g of games) {
      if (fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId)) continue;
      teams.add(g.homeTeamId);
      teams.add(g.awayTeamId);
    }
    const offSum = new Map<string, number[]>();
    const defSum = new Map<string, number[]>();
    for (const id of teams) {
      offSum.set(id, []);
      defSum.set(id, []);
    }
    for (const g of games) {
      if (fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId)) continue;
      offSum.get(g.homeTeamId)!.push(g.homeFg);
      defSum.get(g.homeTeamId)!.push(g.awayFg);
      offSum.get(g.awayTeamId)!.push(g.awayFg);
      defSum.get(g.awayTeamId)!.push(g.homeFg);
    }
    for (const id of teams) {
      this.off.set(id, mean(offSum.get(id)!, this.priorOff));
      this.def.set(id, mean(defSum.get(id)!, this.priorDef));
    }
    for (let iter = 0; iter < 4; iter++) {
      const newOff = new Map<string, number[]>();
      const newDef = new Map<string, number[]>();
      for (const id of teams) {
        newOff.set(id, []);
        newDef.set(id, []);
      }
      for (const g of games) {
        if (fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId)) continue;
        newOff.get(g.homeTeamId)!.push(g.homeFg - (this.getDef(g.awayTeamId) - this.priorDef));
        newOff.get(g.awayTeamId)!.push(g.awayFg - (this.getDef(g.homeTeamId) - this.priorDef));
        newDef.get(g.homeTeamId)!.push(g.awayFg - (this.getOff(g.awayTeamId) - this.priorOff));
        newDef.get(g.awayTeamId)!.push(g.homeFg - (this.getOff(g.homeTeamId) - this.priorOff));
      }
      for (const id of teams) {
        this.off.set(id, mean(newOff.get(id)!, this.priorOff));
        this.def.set(id, mean(newDef.get(id)!, this.priorDef));
      }
    }
  }
  clone() {
    const c = new LegacyOppAdj();
    c.off = new Map(this.off);
    c.def = new Map(this.def);
    c.seasonN = new Map(this.seasonN);
    return c;
  }
  update(g: EspnGame, fcsIds: Set<string>) {
    const fcs = fcsIds.has(g.homeTeamId) || fcsIds.has(g.awayTeamId);
    if (!fcs) {
      const predH =
        0.5 * this.getOff(g.homeTeamId) + 0.5 * this.getDef(g.awayTeamId) + this.hfa / 2;
      const predA =
        0.5 * this.getOff(g.awayTeamId) + 0.5 * this.getDef(g.homeTeamId) - this.hfa / 2;
      const errH = g.homeFg - predH;
      const errA = g.awayFg - predA;
      this.off.set(g.homeTeamId, this.getOff(g.homeTeamId) + this.lr * errH);
      this.def.set(g.awayTeamId, this.getDef(g.awayTeamId) + this.lr * errH);
      this.off.set(g.awayTeamId, this.getOff(g.awayTeamId) + this.lr * errA);
      this.def.set(g.homeTeamId, this.getDef(g.homeTeamId) + this.lr * errA);
    }
    this.seasonN.set(g.homeTeamId, this.getSeasonN(g.homeTeamId) + 1);
    this.seasonN.set(g.awayTeamId, this.getSeasonN(g.awayTeamId) + 1);
  }
}

function legacyPredict(
  seed: LegacyOppAdj,
  live: LegacyOppAdj,
  homeId: string,
  awayId: string,
  week: number,
) {
  // Same math as original v0 full components, including silent defaults
  const seedMu = seed.expectedMu(homeId, awayId);
  const liveMu = live.expectedMu(homeId, awayId);
  const nHome = live.getSeasonN(homeId);
  const nAway = live.getSeasonN(awayId);
  const n = Math.min(nHome, nAway);
  const byGames = 1 / (1 + Math.exp(0.9 * (n - 2)));
  const weekBoost = week <= 1 ? 1.15 : week <= 3 ? 1.05 : week <= 5 ? 0.95 : 0.85;
  const priorWeight = Math.max(0, Math.min(0.95, byGames * weekBoost));
  const mu = priorWeight * seedMu + (1 - priorWeight) * liveMu;
  const thin = 1 + 0.35 * Math.exp(-0.55 * n);
  const weekFactor = week <= 1 ? 1.2 : week <= 3 ? 1.1 : week <= 5 ? 1.05 : 1.0;
  let mismatch = 1;
  if (Math.abs(mu) >= 14) mismatch = 1 + 0.015 * (Math.abs(mu) - 14);
  const sigma = 16.5 * thin * weekFactor * mismatch;
  const normalCdf = (z: number) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p =
      d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  };
  const heavy = (z: number) => 0.82 * normalCdf(z) + 0.18 * normalCdf(z / 2.4);
  const clamp = (x: number) => Math.max(0.02, Math.min(0.98, x));
  const pMl = clamp(1 - heavy(-mu / sigma));
  return {
    mu,
    sigma,
    pMl,
    pAts: (line: number) => clamp(1 - heavy((-line - mu) / sigma)),
    priorWeight,
  };
}

type Pred = {
  pMl: number;
  pAts: number | null;
  predMargin: number;
  sigma: number | null;
  excluded?: boolean;
  excludeReason?: string;
};

type Row = {
  eventId: string;
  week: number;
  matchupSubdivision: MatchupSubdivision;
  favSize: string;
  yMl: number;
  yAts: number | null;
  marketP: number;
  actMargin: number;
  closeSpreadHome: number;
  drive: Pred;
  tsBefore: Pred;
  tsAfter: Pred;
};

function score(rows: Row[], pick: (r: Row) => Pred | null) {
  const usable = rows.filter((r) => {
    const p = pick(r);
    return p && !p.excluded && p.pMl != null;
  });
  const excluded = rows.length - usable.length;
  const p = usable.map((r) => pick(r)!.pMl);
  const y = usable.map((r) => r.yMl);
  const mkt = usable.map((r) => r.marketP);
  const ats = usable.filter((r) => pick(r)!.pAts != null && r.yAts != null);
  const predM = usable.map((r) => pick(r)!.predMargin);
  const actM = usable.map((r) => r.actMargin);
  const mlBrier = p.length ? brier(p, y) : null;
  const mktBrier = p.length ? brier(mkt, y) : null;
  const atsBrier = ats.length
    ? brier(
        ats.map((r) => pick(r)!.pAts!),
        ats.map((r) => r.yAts!),
      )
    : null;
  return {
    cohortN: rows.length,
    scoredN: usable.length,
    excludedN: excluded,
    mlBrier,
    mktBrier,
    delta: mlBrier != null && mktBrier != null ? mlBrier - mktBrier : null,
    M3: mlBrier != null && mktBrier != null ? mlBrier <= mktBrier + 0.02 : null,
    atsN: ats.length,
    atsBrier,
    S2: atsBrier != null ? atsBrier < 0.25 : null,
    meanPred: predM.length ? mean(predM) : null,
    meanAct: actM.length ? mean(actM) : null,
    marginBias: predM.length ? mean(predM) - mean(actM) : null,
  };
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
  process.env.NCAAF_RESEARCH_CALIBRATION = "1";
  process.env.NCAAF_TEAM_STRENGTH_RESEARCH = "1";

  const tuningAll = loadJsonGames(join(FIX, "ncaaf-tuning-2025-w1-7-games.json")).filter(
    (g) => g.season === 2025 && g.week >= 1 && g.week <= 7,
  );
  const prior = loadJsonGames(join(FIX, "ncaaf-phase-e-games.json")).filter(
    (g) => g.season === 2023 || g.season === 2024,
  );
  const archive = JSON.parse(
    readFileSync(join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json"), "utf8"),
  ) as { games: CloseRow[]; missing: unknown[] };
  const closes = new Map(archive.games.map((g) => [String(g.gameId), g]));
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

  const nameById = new Map<string, string>();
  for (const g of [...prior, ...tuningAll]) {
    if (g.homeName) nameById.set(g.homeTeamId, g.homeName);
    if (g.awayName) nameById.set(g.awayTeamId, g.awayName);
  }
  const legacyFcs = new Set<string>();
  for (const [id, name] of nameById) {
    if (LEGACY_FCS_RE.test((name || "").toLowerCase())) legacyFcs.add(id);
  }

  // BEFORE: legacy polluted seed
  const legacySeed = new LegacyOppAdj();
  legacySeed.seedFromPrior(
    prior.filter((g) => g.season === 2024),
    legacyFcs,
  );
  const legacyLive = legacySeed.clone();

  // AFTER: verified FBS–FBS chronological rebuild
  const afterSeed = new NcaafOppAdjRatings();
  afterSeed.seedFromPrior(prior.filter((g) => g.season === 2024) as TeamStrengthGame[]);
  const afterLive = afterSeed.clone();

  const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED);
  const all = [...prior, ...tuningAll].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  const rows: Row[] = [];
  let skippedThin = 0;
  let tsAfterExcluded = 0;

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
          const yMl = g.homeFg > g.awayFg ? 1 : 0;
          const adj = g.homeFg - g.awayFg + close.closeSpreadHome!;
          const yAts = Math.abs(adj) < 1e-9 ? null : adj > 0 ? 1 : 0;
          const matchupSubdivision = classifyMatchupSubdivision(
            g.homeTeamId,
            g.awayTeamId,
            g.season,
          );

          const before = legacyPredict(
            legacySeed,
            legacyLive,
            g.homeTeamId,
            g.awayTeamId,
            g.week,
          );
          const after = predictTeamStrength({
            seed: afterSeed,
            live: afterLive,
            homeId: g.homeTeamId,
            awayId: g.awayTeamId,
            week: g.week,
            components: TEAM_STRENGTH_FULL,
          });

          let tsAfter: Pred;
          if (!after) {
            tsAfterExcluded += 1;
            tsAfter = {
              pMl: NaN,
              pAts: null,
              predMargin: NaN,
              sigma: null,
              excluded: true,
              excludeReason: "unrated_side_no_invented_default",
            };
          } else {
            tsAfter = {
              pMl: after.pHomeMl,
              pAts: after.pHomeCover(close.closeSpreadHome!),
              predMargin: after.mu,
              sigma: after.sigma,
            };
          }

          rows.push({
            eventId: g.eventId,
            week: g.week,
            matchupSubdivision,
            favSize: favSize(Math.abs(close.closeSpreadHome!)),
            yMl,
            yAts,
            marketP: americanToImplied(close.closeMlHome!),
            actMargin: g.homeFg - g.awayFg,
            closeSpreadHome: close.closeSpreadHome!,
            drive: {
              pMl: pLocked,
              pAts: simLocked.coverHitRates?.["home-close-spread"] ?? null,
              predMargin:
                (simLocked.expectedHomeScore ?? homeBlend) -
                (simLocked.expectedAwayScore ?? awayBlend),
              sigma: null,
            },
            tsBefore: {
              pMl: before.pMl,
              pAts: before.pAts(close.closeSpreadHome!),
              predMargin: before.mu,
              sigma: before.sigma,
            },
            tsAfter,
          });
        }
      }
    }

    if (g.season === 2025) {
      legacyLive.update(g, legacyFcs);
      afterLive.update(g);
    }
  });

  const sliceDefs: Array<{ id: string; filter: (r: Row) => boolean }> = [
    { id: "all_fair", filter: () => true },
    { id: "fbs_fbs", filter: (r) => r.matchupSubdivision === "fbs_fbs" },
    { id: "fbs_fcs", filter: (r) => r.matchupSubdivision === "fbs_fcs" },
    { id: "week1", filter: (r) => r.week === 1 },
    { id: "large_14plus", filter: (r) => r.favSize === "large_14plus" },
    {
      id: "fbs_fbs_week1",
      filter: (r) => r.matchupSubdivision === "fbs_fbs" && r.week === 1,
    },
    {
      id: "fbs_fbs_large_14plus",
      filter: (r) => r.matchupSubdivision === "fbs_fbs" && r.favSize === "large_14plus",
    },
  ];

  const slices: Record<string, unknown> = {};
  for (const s of sliceDefs) {
    const rs = rows.filter(s.filter);
    slices[s.id] = {
      n: rs.length,
      matchupCounts: {
        fbs_fbs: rs.filter((r) => r.matchupSubdivision === "fbs_fbs").length,
        fbs_fcs: rs.filter((r) => r.matchupSubdivision === "fbs_fcs").length,
        fcs_fcs: rs.filter((r) => r.matchupSubdivision === "fcs_fcs").length,
        involves_unknown: rs.filter((r) => r.matchupSubdivision === "involves_unknown")
          .length,
      },
      locked_drive_teamMean: score(rs, (r) => r.drive),
      ts_full_before_legacyHeuristic: score(rs, (r) => r.tsBefore),
      ts_full_after_verifiedIds: score(rs, (r) => r.tsAfter),
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    split: "TUNING",
    finalEvalUntouched: true,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    paidRetrieval: false,
    closesInPredictiveFeatures: false,
    researchFlag: "NCAAF_TEAM_STRENGTH_RESEARCH=1",
    stamps: {
      liveDrive: FOOTBALL_DRIVE_ENGINE_VERSION,
      teamStrength: FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
      note: "No new model — classification + chronological rebuild only",
    },
    lockedParamsPreserved: {
      residualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
      homeShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
    },
    simsPerGame: SIMS,
    fairCohortN: rows.length,
    skippedThin,
    tsAfterExcludedUnrated: tsAfterExcluded,
    legacyFcsNameHeuristicCount: legacyFcs.size,
    afterSeededTeams: afterSeed.off.size,
    beforeSeededTeams: legacySeed.off.size,
    slices,
    discipline: {
      arbitraryStrengthFit: false,
      unknownsStayUnknown: true,
      ratingsRebuiltChronologically: true,
      notOnlyRelabeledPredictions: true,
    },
  };

  writeFileSync(
    join(FIX, "ncaaf-tuning-subdivision-fix-compare.json"),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    join(ART, "ncaaf-tuning-subdivision-fix-compare.json"),
    JSON.stringify(report, null, 2),
  );

  const md: string[] = [];
  md.push("# TUNING: subdivision classification fix — before/after");
  md.push("");
  md.push(
    `**Stamp unchanged:** \`${FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION}\` · drive locked · FINAL_EVAL untouched · gate false · no paid Odds · no new model`,
  );
  md.push("");
  md.push("## What changed");
  md.push("");
  md.push(
    "- **BEFORE:** name-heuristic FCS set (missed 50+ FCS; false-tagged Delaware as FCS in 2025); silent default-24 μ",
  );
  md.push(
    "- **AFTER:** season-specific ESPN FBS/FCS IDs; seed/update only verified FBS–FBS; chronological rebuild; unrated → explicit TS exclusion (no invented defaults)",
  );
  md.push(`- Drive model: **unchanged** (control).`);
  md.push(
    `- Seeded teams: before=${legacySeed.off.size} · after=${afterSeed.off.size} · TS after exclusions (unrated)=${tsAfterExcluded}`,
  );
  md.push("");
  md.push("## Slice metrics");
  md.push("");
  for (const s of sliceDefs) {
    const block = slices[s.id] as any;
    md.push(`### \`${s.id}\` (n=${block.n})`);
    md.push("");
    md.push(
      `| Model | scored | excl | ML Brier | Δ mkt | M3 | ATS n | ATS | S2 | bias |`,
    );
    md.push(
      `|-------|-------:|-----:|---------:|------:|:--:|------:|----:|:--:|-----:|`,
    );
    for (const [label, key] of [
      ["locked_drive", "locked_drive_teamMean"],
      ["ts_before_legacy", "ts_full_before_legacyHeuristic"],
      ["ts_after_verified", "ts_full_after_verifiedIds"],
    ] as const) {
      const m = block[key];
      const fmt = (x: number | null, d = 4) =>
        x == null || !Number.isFinite(x) ? "—" : x.toFixed(d);
      md.push(
        `| \`${label}\` | ${m.scoredN} | ${m.excludedN} | ${fmt(m.mlBrier)} | ${fmt(m.delta)} | ${m.M3} | ${m.atsN} | ${fmt(m.atsBrier)} | ${m.S2} | ${fmt(m.marginBias, 1)} |`,
      );
    }
    md.push("");
  }
  md.push("## Conclusion");
  md.push("");
  md.push(
    "- Classification defect addressed with verified season-specific IDs + chronological FBS–FBS rebuild.",
  );
  md.push(
    "- Gate flip: **false**. FINAL_EVAL: **UNTOUCHED**. No deploy/OTA. No new model yet.",
  );
  md.push("");
  md.push("## Repro");
  md.push("```bash");
  md.push("cd artifacts/api-server");
  md.push(
    "node --import ./test/register-hooks.mjs ./scripts/ncaafRetagSubdivision.ts",
  );
  md.push(
    "NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningSubdivisionFixCompare.ts",
  );
  md.push("```");

  const mdText = md.join("\n");
  writeFileSync(join(FIX, "ncaaf-tuning-subdivision-fix-compare.md"), mdText);
  writeFileSync(join(ART, "ncaaf-tuning-subdivision-fix-compare.md"), mdText);
  writeFileSync(join(DOCS, "ncaaf-tuning-subdivision-fix-compare.md"), mdText);

  const allSlice = slices.all_fair as any;
  console.log(
    JSON.stringify(
      {
        fairN: rows.length,
        tsAfterExcluded,
        all: {
          drive: allSlice.locked_drive_teamMean,
          before: allSlice.ts_full_before_legacyHeuristic,
          after: allSlice.ts_full_after_verifiedIds,
        },
        fbs_fbs: (slices.fbs_fbs as any).ts_full_after_verifiedIds,
        fbs_fcs: (slices.fbs_fcs as any).ts_full_after_verifiedIds,
      },
      null,
      2,
    ),
  );
  return 0;
}

process.exit(main());
