/**
 * E1 research-only: prior talent-gap scale α ∈ {1.15, 1.25} vs frozen A0.
 * Protocol (frozen before scores): docs/coach/ncaaf-clean-e1-eval-protocol.md
 * HFA placement + σ unchanged. No grid expansion. FINAL_EVAL untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLEAN_HFA_POINTS,
  CleanOppAdjStrength,
  NCAAF_CLEAN_ENGINE_STAMP,
  buildPregameFromFixtureRow,
  cleanMarginSd,
  cleanTotalSd,
  cleanUncertainty,
  pHomeCoverFromMargin,
  pHomeMlFromMargin,
  predictScoreMargin,
  settleAtsHome,
  settleMoneyline,
  type CleanFixtureGameRow,
} from "../src/lib/sportSim/ncaafClean/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");

/** Frozen grid — do not expand. */
const ALPHAS = [1.15, 1.25] as const;
type Alpha = (typeof ALPHAS)[number];
type VariantId = "A0" | "E1_a115" | "E1_a125";

function variantIdForAlpha(alpha: Alpha): VariantId {
  return alpha === 1.15 ? "E1_a115" : "E1_a125";
}

const BOOT_B = 400;
const BOOT_SEED = 20261017; // fixed for reproducibility

type CloseRow = {
  gameId: string;
  closeMlHome?: number | null;
  closeSpreadHome?: number | null;
};

type PredRow = {
  eventId: string;
  week: number;
  absSpread: number;
  marginMean: number;
  marginSd: number;
  uncertainty: number;
  actMargin: number;
  residual: number;
  compression: number; // absSpread - abs(marginMean)
  pMl: number;
  pMkt: number;
  yMl: number;
  pAts: number | null;
  yAts: number | null;
};

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))!);
}

function seMean(xs: number[]): number | null {
  const s = sd(xs);
  if (s == null) return null;
  return s / Math.sqrt(xs.length);
}

function rmse(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.sqrt(mean(xs.map((x) => x * x))!);
}

function brier(ps: number[], ys: number[]): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

/** Mulberry32 PRNG for reproducible bootstrap. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapSe(
  n: number,
  stat: (idx: number[]) => number | null,
  seed: number,
  B = BOOT_B,
): number | null {
  if (n < 5) return null;
  const rand = mulberry32(seed);
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(Math.floor(rand() * n));
    const v = stat(idx);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  return sd(vals);
}

function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
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
const closes = new Map(
  loadJson<{ games: CloseRow[] }>("ncaaf-tuning-2025-w1-7-closing-lines.json").games.map(
    (c) => [String(c.gameId), c],
  ),
);
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
    if (c.closeMlHome == null || c.closeSpreadHome == null) return false;
    if (tags.get(eid) !== "fbs_fbs") return false;
    if (unrated.has(eid)) return false;
    if (c.homeScore != null && c.awayScore != null && c.homeScore === c.awayScore) {
      return false;
    }
    return true;
  }),
);

/**
 * Predict with optional gap scale α.
 * α=1 → identical to A0 path via predictScoreMargin.
 * α≠1 → ratingGap scaled, then HFA added; σ/uncertainty unchanged.
 */
function predictWithAlpha(
  pregame: ReturnType<typeof buildPregameFromFixtureRow>,
  strength: CleanOppAdjStrength,
  alpha: number,
): {
  ok: boolean;
  evaluableSupported: boolean;
  marginMean: number;
  marginSd: number;
  uncertainty: number;
  homeScoreMean: number;
  awayScoreMean: number;
} | null {
  if (alpha === 1) {
    const pred = predictScoreMargin({ pregame, strength });
    if (!pred.ok) return null;
    return {
      ok: true,
      evaluableSupported: pred.evaluableSupported,
      marginMean: pred.marginMean,
      marginSd: pred.marginSd,
      uncertainty: pred.uncertainty,
      homeScoreMean: pred.homeScoreMean,
      awayScoreMean: pred.awayScoreMean,
    };
  }

  // Mirror support / HFA / σ from predictScoreMargin without changing engine stamp path.
  const supportOk =
    strength.hasRating(pregame.home.teamId) &&
    strength.hasRating(pregame.away.teamId);
  // Use full predict for support/venue gate
  const base = predictScoreMargin({ pregame, strength });
  if (!base.ok || !supportOk) return null;

  const hfaPoints =
    pregame.venue.kind === "home" ? CLEAN_HFA_POINTS : 0;
  const pts0 = strength.expectedPoints(
    pregame.home.teamId,
    pregame.away.teamId,
    0,
  );
  const ratingGap = pts0.marginMean;
  const totalMean = pts0.totalMean;
  const marginMean = alpha * ratingGap + hfaPoints;
  const homeScoreMean = (totalMean + marginMean) / 2;
  const awayScoreMean = (totalMean - marginMean) / 2;

  const week = pregame.week ?? 99;
  const uncertainty = cleanUncertainty({
    week,
    nHomeFbsGames: strength.getSeasonN(pregame.home.teamId),
    nAwayFbsGames: strength.getSeasonN(pregame.away.teamId),
  });
  const marginSd = cleanMarginSd(uncertainty);
  // totalSd unused in ML/ATS screen but keep formula frozen
  void cleanTotalSd(uncertainty);

  return {
    ok: true,
    evaluableSupported: base.evaluableSupported,
    marginMean,
    marginSd,
    uncertainty,
    homeScoreMean,
    awayScoreMean,
  };
}

function runVariant(alpha: number): PredRow[] {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.seedFromPriorSeason(
    phaseE
      .filter((g) => g.season === 2024 && g.homeFg != null && g.awayFg != null)
      .map((g) => ({
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeFg: g.homeFg!,
        awayFg: g.awayFg!,
        season: g.season,
        kickoffIso: g.kickoffIso,
      })),
  );

  const out: PredRow[] = [];
  const games = [...tuningDoc.games].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  for (const g of games) {
    const pre = buildPregameFromFixtureRow(g, { useVenueSidecar: true });
    const close = closes.get(String(g.eventId));
    const pred = predictWithAlpha(pre, strength, alpha);

    if (
      pred &&
      pred.evaluableSupported &&
      identicalIds.has(String(g.eventId)) &&
      close?.closeMlHome != null &&
      close.closeSpreadHome != null &&
      g.homeFg != null &&
      g.awayFg != null
    ) {
      const ml = settleMoneyline({
        homeScore: g.homeFg,
        awayScore: g.awayFg,
        decided: true,
      });
      if (ml.ok) {
        const actMargin = g.homeFg - g.awayFg;
        const residual = actMargin - pred.marginMean;
        const absSpread = Math.abs(close.closeSpreadHome);
        const ats = settleAtsHome({
          homeScore: g.homeFg,
          awayScore: g.awayFg,
          homeSpreadLine: close.closeSpreadHome,
          decided: true,
        });
        out.push({
          eventId: String(g.eventId),
          week: g.week ?? 0,
          absSpread,
          marginMean: pred.marginMean,
          marginSd: pred.marginSd,
          uncertainty: pred.uncertainty,
          actMargin,
          residual,
          compression: absSpread - Math.abs(pred.marginMean),
          pMl: pHomeMlFromMargin(pred.marginMean, pred.marginSd),
          pMkt: americanToImplied(close.closeMlHome),
          yMl: ml.yHomeWin,
          pAts: pHomeCoverFromMargin(
            pred.marginMean,
            pred.marginSd,
            close.closeSpreadHome,
          ),
          yAts: ats.ok ? ats.yHomeCover : null,
        });
      }
    }

    if (g.homeFg != null && g.awayFg != null) {
      strength.update({
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeFg: g.homeFg,
        awayFg: g.awayFg,
        season: g.season,
        kickoffIso: g.kickoffIso,
      });
    }
  }
  return out;
}

type SliceKey = "overall" | "week1" | "large_gt14" | `W${number}`;

function filterSlice(rows: PredRow[], key: SliceKey): PredRow[] {
  if (key === "overall") return rows;
  if (key === "week1") return rows.filter((r) => r.week === 1);
  if (key === "large_gt14") return rows.filter((r) => r.absSpread > 14);
  const w = Number(key.slice(1));
  return rows.filter((r) => r.week === w);
}

function sliceMetrics(rows: PredRow[], seedOff: number) {
  const resid = rows.map((r) => r.residual);
  const comp = rows.map((r) => r.compression);
  const mlRows = rows;
  const atsRows = rows.filter((r) => r.pAts != null && r.yAts != null);
  const pushEx = rows.filter((r) => r.pAts != null && r.yAts == null).length;
  const mlB = brier(
    mlRows.map((r) => r.pMl),
    mlRows.map((r) => r.yMl),
  );
  const mkB = brier(
    mlRows.map((r) => r.pMkt),
    mlRows.map((r) => r.yMl),
  );
  const atsB = brier(
    atsRows.map((r) => r.pAts!),
    atsRows.map((r) => r.yAts!),
  );
  const absZ = rows.map((r) => Math.abs(r.residual / Math.max(1e-6, r.marginSd)));
  const meanSd = mean(rows.map((r) => r.marginSd));
  const rmseRes = rmse(resid);

  const bootMeanRes = bootstrapSe(
    rows.length,
    (idx) => mean(idx.map((i) => resid[i]!)),
    BOOT_SEED + seedOff,
  );
  const bootRmse = bootstrapSe(
    rows.length,
    (idx) => rmse(idx.map((i) => resid[i]!)),
    BOOT_SEED + seedOff + 1,
  );
  const bootMl = bootstrapSe(
    mlRows.length,
    (idx) =>
      brier(
        idx.map((i) => mlRows[i]!.pMl),
        idx.map((i) => mlRows[i]!.yMl),
      ),
    BOOT_SEED + seedOff + 2,
  );
  const bootMkt = bootstrapSe(
    mlRows.length,
    (idx) =>
      brier(
        idx.map((i) => mlRows[i]!.pMkt),
        idx.map((i) => mlRows[i]!.yMl),
      ),
    BOOT_SEED + seedOff + 3,
  );
  const bootAts = bootstrapSe(
    atsRows.length,
    (idx) =>
      brier(
        idx.map((i) => atsRows[i]!.pAts!),
        idx.map((i) => atsRows[i]!.yAts!),
      ),
    BOOT_SEED + seedOff + 4,
  );

  return {
    nMl: mlRows.length,
    nAts: atsRows.length,
    nPushExcludedAts: pushEx,
    meanResidual: mean(resid),
    meanResidualSe: seMean(resid),
    meanResidualBootSe: bootMeanRes,
    meanCompressionVsLine: mean(comp),
    meanCompressionVsLineSe: seMean(comp),
    rmseResidual: rmseRes,
    rmseResidualBootSe: bootRmse,
    meanAbsZ: mean(absZ),
    meanAbsZSe: seMean(absZ),
    meanMarginSd: meanSd,
    rmseOverMeanSd:
      rmseRes != null && meanSd != null && meanSd > 0 ? rmseRes / meanSd : null,
    mlBrier: mlB,
    mlBrierBootSe: bootMl,
    mktBrier: mkB,
    mktBrierBootSe: bootMkt,
    deltaVsMarket: mlB != null && mkB != null ? mlB - mkB : null,
    deltaVsMarketBootSe:
      bootMl != null && bootMkt != null
        ? Math.sqrt(bootMl * bootMl + bootMkt * bootMkt)
        : null,
    M3descriptive: mlB != null && mkB != null ? mlB <= mkB + 0.02 : null,
    atsBrier: atsB,
    atsBrierBootSe: bootAts,
    S2descriptive: atsB != null ? atsB < 0.25 : null,
  };
}

/** Paired A0 vs α on shared event IDs. */
function pairedDeltas(
  a0: PredRow[],
  ax: PredRow[],
  slice: SliceKey,
  seedOff: number,
) {
  const map0 = new Map(a0.map((r) => [r.eventId, r]));
  const mapX = new Map(ax.map((r) => [r.eventId, r]));
  const ids = [...map0.keys()].filter((id) => mapX.has(id));
  const s0 = ids
    .map((id) => map0.get(id)!)
    .filter((r) => {
      if (slice === "overall") return true;
      if (slice === "week1") return r.week === 1;
      if (slice === "large_gt14") return r.absSpread > 14;
      return r.week === Number(String(slice).slice(1));
    });
  const sx = s0.map((r) => mapX.get(r.eventId)!);
  const n = s0.length;

  const dRes = s0.map((r, i) => r.residual - sx[i]!.residual); // A0 - α; + ⇒ α less residual
  // For L_W1: improve = meanRes_A0 - meanRes_α ≥ 1 SE
  const dMeanRes = s0.map((r, i) => r.residual - sx[i]!.residual);
  const dComp = s0.map((r, i) => r.compression - sx[i]!.compression); // + ⇒ α less compressed

  const atsPairs = s0
    .map((r, i) => ({ a: r, b: sx[i]! }))
    .filter((p) => p.a.pAts != null && p.a.yAts != null && p.b.pAts != null);

  const meanResA0 = mean(s0.map((r) => r.residual));
  const meanResAx = mean(sx.map((r) => r.residual));
  const deltaMeanRes = meanResA0 != null && meanResAx != null ? meanResA0 - meanResAx : null;
  const seMeanRes = seMean(dMeanRes);

  const compA0 = mean(s0.map((r) => r.compression));
  const compAx = mean(sx.map((r) => r.compression));
  const deltaComp = compA0 != null && compAx != null ? compA0 - compAx : null;
  const seComp = seMean(dComp);

  const mlA0 = brier(
    s0.map((r) => r.pMl),
    s0.map((r) => r.yMl),
  );
  const mlAx = brier(
    sx.map((r) => r.pMl),
    sx.map((r) => r.yMl),
  );
  const mkt = brier(
    s0.map((r) => r.pMkt),
    s0.map((r) => r.yMl),
  );
  const deltaMktA0 = mlA0 != null && mkt != null ? mlA0 - mkt : null;
  const deltaMktAx = mlAx != null && mkt != null ? mlAx - mkt : null;
  // worsen metric: deltaMkt_α - deltaMkt_A0 (positive = α worse vs market)
  const dDeltaMkt =
    deltaMktAx != null && deltaMktA0 != null ? deltaMktAx - deltaMktA0 : null;
  const bootDDeltaMkt = bootstrapSe(
    n,
    (idx) => {
      const p0 = idx.map((i) => s0[i]!.pMl);
      const px = idx.map((i) => sx[i]!.pMl);
      const pk = idx.map((i) => s0[i]!.pMkt);
      const y = idx.map((i) => s0[i]!.yMl);
      const b0 = brier(p0, y);
      const bx = brier(px, y);
      const bm = brier(pk, y);
      if (b0 == null || bx == null || bm == null) return null;
      return bx - bm - (b0 - bm);
    },
    BOOT_SEED + seedOff + 10,
  );

  const atsA0 = brier(
    atsPairs.map((p) => p.a.pAts!),
    atsPairs.map((p) => p.a.yAts!),
  );
  const atsAx = brier(
    atsPairs.map((p) => p.b.pAts!),
    atsPairs.map((p) => p.a.yAts!),
  );
  const dAts = atsAx != null && atsA0 != null ? atsAx - atsA0 : null;
  const bootDAts = bootstrapSe(
    atsPairs.length,
    (idx) => {
      const b0 = brier(
        idx.map((i) => atsPairs[i]!.a.pAts!),
        idx.map((i) => atsPairs[i]!.a.yAts!),
      );
      const bx = brier(
        idx.map((i) => atsPairs[i]!.b.pAts!),
        idx.map((i) => atsPairs[i]!.a.yAts!),
      );
      if (b0 == null || bx == null) return null;
      return bx - b0;
    },
    BOOT_SEED + seedOff + 20,
  );

  function passImprove(delta: number | null, se: number | null): boolean | null {
    if (delta == null || se == null) return null;
    return delta >= 1 * se;
  }
  function passNotWorsen(deltaWorse: number | null, se: number | null): boolean | null {
    if (deltaWorse == null || se == null) return null;
    return deltaWorse <= 1 * se;
  }

  return {
    n,
    L_W1_or_applicable: {
      meanResidualA0: meanResA0,
      meanResidualAx: meanResAx,
      deltaA0minusAx: deltaMeanRes,
      sePaired: seMeanRes,
      passImprove: passImprove(deltaMeanRes, seMeanRes),
    },
    L_LG_or_applicable: {
      compressionA0: compA0,
      compressionAx: compAx,
      deltaA0minusAx: deltaComp,
      sePaired: seComp,
      passImprove: passImprove(deltaComp, seComp),
    },
    M_ALL: {
      deltaVsMarketA0: deltaMktA0,
      deltaVsMarketAx: deltaMktAx,
      deltaWorseAxMinusA0: dDeltaMkt,
      sePairedBoot: bootDDeltaMkt,
      passNotWorsen: passNotWorsen(dDeltaMkt, bootDDeltaMkt),
    },
    S_ALL: {
      atsBrierA0: atsA0,
      atsBrierAx: atsAx,
      deltaWorseAxMinusA0: dAts,
      sePairedBoot: bootDAts,
      passNotWorsen: passNotWorsen(dAts, bootDAts),
    },
    // unused suppress
    _dResN: dRes.length,
  };
}

const a0Rows = runVariant(1);
const variants: Record<VariantId, PredRow[]> = {
  A0: a0Rows,
  E1_a115: runVariant(1.15),
  E1_a125: runVariant(1.25),
};

const sliceKeysAdoption: SliceKey[] = ["overall", "week1", "large_gt14"];
const weekKeys: SliceKey[] = [1, 2, 3, 4, 5, 6, 7].map((w) => `W${w}` as SliceKey);

const absoluteByVariant: Record<string, Record<string, ReturnType<typeof sliceMetrics>>> =
  {};
for (const [vid, rows] of Object.entries(variants)) {
  absoluteByVariant[vid] = {};
  let off = 0;
  for (const sk of [...sliceKeysAdoption, ...weekKeys]) {
    absoluteByVariant[vid]![sk] = sliceMetrics(filterSlice(rows, sk), off);
    off += 100;
  }
}

type AdoptEval = {
  alpha: Alpha;
  variantId: VariantId;
  clauses: {
    L_W1: ReturnType<typeof pairedDeltas>["L_W1_or_applicable"] & { slice: "week1" };
    L_LG: ReturnType<typeof pairedDeltas>["L_LG_or_applicable"] & {
      slice: "large_gt14";
    };
    M_ALL: ReturnType<typeof pairedDeltas>["M_ALL"] & { slice: "overall" };
    S_ALL: ReturnType<typeof pairedDeltas>["S_ALL"] & { slice: "overall" };
  };
  failedClauses: string[];
  passResearch: boolean;
};

const adoption: AdoptEval[] = [];
for (const alpha of ALPHAS) {
  const vid = variantIdForAlpha(alpha);
  const pW1 = pairedDeltas(a0Rows, variants[vid]!, "week1", 1000 + alpha * 100);
  const pLg = pairedDeltas(a0Rows, variants[vid]!, "large_gt14", 2000 + alpha * 100);
  const pAll = pairedDeltas(a0Rows, variants[vid]!, "overall", 3000 + alpha * 100);

  const clauses = {
    L_W1: { ...pW1.L_W1_or_applicable, slice: "week1" as const },
    L_LG: { ...pLg.L_LG_or_applicable, slice: "large_gt14" as const },
    M_ALL: { ...pAll.M_ALL, slice: "overall" as const },
    S_ALL: { ...pAll.S_ALL, slice: "overall" as const },
  };
  const failed: string[] = [];
  if (clauses.L_W1.passImprove !== true) failed.push("L_W1");
  if (clauses.L_LG.passImprove !== true) failed.push("L_LG");
  if (clauses.M_ALL.passNotWorsen !== true) failed.push("M_ALL");
  if (clauses.S_ALL.passNotWorsen !== true) failed.push("S_ALL");

  adoption.push({
    alpha,
    variantId: vid,
    clauses,
    failedClauses: failed,
    passResearch: failed.length === 0,
  });
}

const anyPass = adoption.some((a) => a.passResearch);
const e1Status = anyPass
  ? {
      status: "PASS_RESEARCH_CANDIDATE" as const,
      note: "Further research only — does not replace M3/S2, injury validation, or final review. FINAL_EVAL not advanced.",
      passingAlphas: adoption.filter((a) => a.passResearch).map((a) => a.alpha),
    }
  : {
      status: "CLOSED" as const,
      note: "Neither α∈{1.15,1.25} met PASS_RESEARCH. Keep A0. No further scalar sweep.",
      passingAlphas: [] as number[],
    };

const report = {
  generatedAt: new Date().toISOString(),
  stamp: NCAAF_CLEAN_ENGINE_STAMP,
  protocol: "docs/coach/ncaaf-clean-e1-eval-protocol.md",
  protocolCommitNote: "Protocol frozen in prior commit before this score run",
  alphas: [...ALPHAS],
  gridExpansion: false,
  ops: {
    finalEval: "UNTOUCHED",
    ncaafGate: false,
    injuryValidation: "OPEN",
    productionFreeze: true,
    voice: "paused",
    paidRetrieval: false,
    deployOta: false,
  },
  adoptionScope:
    "PASS_RESEARCH permits further research only; does not replace locked M3/S2, injury validation, or human final review",
  identicalN: a0Rows.length,
  e1Status,
  adoption,
  absoluteByVariant,
  locationMetricDefinitions: {
    L_W1: "Week-1 meanResidual; improve iff meanRes_A0 - meanRes_α ≥ 1 SE_paired",
    L_LG: "Large abs>14 meanCompressionVsLine = mean(|spread|-|marginMean|); improve iff comp_A0 - comp_α ≥ 1 SE_paired",
  },
};

writeFileSync(
  join(FIX, "ncaaf-clean-e1-gap-scale.json"),
  JSON.stringify(report, null, 2) + "\n",
);

function fmt(x: number | null | undefined, d = 4): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(d);
}

function clauseLine(
  name: string,
  pass: boolean | null,
  delta: number | null,
  se: number | null,
  detail: string,
): string {
  const mark = pass === true ? "PASS" : pass === false ? "FAIL" : "n/a";
  return `| ${name} | **${mark}** | ${fmt(delta)} ± ${fmt(se)} | ${detail} |`;
}

const mdParts: string[] = [];
mdParts.push(`# E1 gap-scale results (research-only)

**Stamp:** \`${NCAAF_CLEAN_ENGINE_STAMP}\`  
**Generated:** ${report.generatedAt}  
**Protocol (frozen pre-scores):** \`ncaaf-clean-e1-eval-protocol.md\`  
**α grid:** {${ALPHAS.join(", ")}} — **no expansion**  
**E1 status:** **${e1Status.status}** — ${e1Status.note}  
**Ops:** FINAL_EVAL untouched · NCAAF blocked · injury OPEN · freeze · voice paused · no spend/deploy/OTA

## Adoption scope

PASS_RESEARCH = further research permission only. **Does not** replace locked M3/S2, injury validation, or final review.

## Location metric definitions

| ID | Definition |
|----|------------|
| **L_W1** | Week-1 \`meanResidual\`; improve iff \`meanRes_A0 − meanRes_α ≥ 1 SE_paired\` |
| **L_LG** | Large (\`abs(closeSpreadHome)>14\`) \`meanCompressionVsLine = mean(|spread| − |marginMean|)\`; improve iff \`comp_A0 − comp_α ≥ 1 SE_paired\` |

## Absolute metrics (identical-334)

`);

for (const vid of ["A0", "E1_a115", "E1_a125"] as VariantId[]) {
  const label =
    vid === "A0" ? "A0 (α=1)" : vid === "E1_a115" ? "E1 α=1.15" : "E1 α=1.25";
  const m = absoluteByVariant[vid]!;
  mdParts.push(`### ${label}

| Slice | nML / nATS | mean resid ± SE | compression ± SE | ML Δ vs mkt | ATS Brier | M3* | S2* |
|-------|------------|----------------:|-----------------:|------------:|----------:|:---:|:---:|
`);
  for (const sk of sliceKeysAdoption) {
    const s = m[sk]!;
    mdParts.push(
      `| ${sk} | ${s.nMl} / ${s.nAts} (push ${s.nPushExcludedAts}) | ${fmt(s.meanResidual, 3)}±${fmt(s.meanResidualSe, 2)} | ${fmt(s.meanCompressionVsLine, 3)}±${fmt(s.meanCompressionVsLineSe, 2)} | ${fmt(s.deltaVsMarket)} | ${fmt(s.atsBrier)} | ${s.M3descriptive} | ${s.S2descriptive} |\n`,
    );
  }
  mdParts.push("\n");
}

mdParts.push(`\\*M3/S2 descriptive only — not E1 adoption and not locked acceptance.

## Paired adoption clauses vs A0

`);

for (const a of adoption) {
  mdParts.push(`### ${a.variantId} — PASS_RESEARCH = **${a.passResearch}**

Failed clauses: ${a.failedClauses.length ? a.failedClauses.join(", ") : "(none)"}

| Clause | Result | Δ ± SE_paired | Detail |
|--------|--------|---------------|--------|
`);
  mdParts.push(
    clauseLine(
      "L_W1",
      a.clauses.L_W1.passImprove,
      a.clauses.L_W1.deltaA0minusAx,
      a.clauses.L_W1.sePaired,
      `meanRes ${fmt(a.clauses.L_W1.meanResidualA0, 3)} → ${fmt(a.clauses.L_W1.meanResidualAx, 3)}`,
    ) + "\n",
  );
  mdParts.push(
    clauseLine(
      "L_LG",
      a.clauses.L_LG.passImprove,
      a.clauses.L_LG.deltaA0minusAx,
      a.clauses.L_LG.sePaired,
      `comp ${fmt(a.clauses.L_LG.compressionA0, 3)} → ${fmt(a.clauses.L_LG.compressionAx, 3)}`,
    ) + "\n",
  );
  mdParts.push(
    clauseLine(
      "M_ALL",
      a.clauses.M_ALL.passNotWorsen,
      a.clauses.M_ALL.deltaWorseAxMinusA0,
      a.clauses.M_ALL.sePairedBoot,
      `Δmkt ${fmt(a.clauses.M_ALL.deltaVsMarketA0)} → ${fmt(a.clauses.M_ALL.deltaVsMarketAx)} (Δworse=α−A0)`,
    ) + "\n",
  );
  mdParts.push(
    clauseLine(
      "S_ALL",
      a.clauses.S_ALL.passNotWorsen,
      a.clauses.S_ALL.deltaWorseAxMinusA0,
      a.clauses.S_ALL.sePairedBoot,
      `ATS ${fmt(a.clauses.S_ALL.atsBrierA0)} → ${fmt(a.clauses.S_ALL.atsBrierAx)}`,
    ) + "\n\n",
  );
}

mdParts.push(`## Time-ordered week folds (absolute)

| Variant | Week | nML | mean resid | ML Δ | ATS Brier |
|---------|-----:|----:|-----------:|-----:|----------:|
`);
for (const vid of ["A0", "E1_a115", "E1_a125"] as VariantId[]) {
  const label =
    vid === "A0" ? "A0" : vid === "E1_a115" ? "α=1.15" : "α=1.25";
  for (const sk of weekKeys) {
    const s = absoluteByVariant[vid]![sk]!;
    mdParts.push(
      `| ${label} | ${sk} | ${s.nMl} | ${fmt(s.meanResidual, 3)} | ${fmt(s.deltaVsMarket)} | ${fmt(s.atsBrier)} |\n`,
    );
  }
}

mdParts.push(`
## Decision

**${e1Status.status}** — ${e1Status.note}

Baseline remains **A0_full** for production-research freeze. No σ/HFA/LR change. No further α sweep.

Fixture: \`artifacts/api-server/test/fixtures/ncaaf-clean-e1-gap-scale.json\`
`);

const md = mdParts.join("");
writeFileSync(join(FIX, "ncaaf-clean-e1-gap-scale.md"), md);
writeFileSync(join(DOCS, "ncaaf-clean-e1-gap-scale.md"), md);

console.log(
  JSON.stringify(
    {
      e1Status,
      adoption: adoption.map((a) => ({
        alpha: a.alpha,
        passResearch: a.passResearch,
        failedClauses: a.failedClauses,
        L_W1: {
          d: a.clauses.L_W1.deltaA0minusAx,
          se: a.clauses.L_W1.sePaired,
          pass: a.clauses.L_W1.passImprove,
        },
        L_LG: {
          d: a.clauses.L_LG.deltaA0minusAx,
          se: a.clauses.L_LG.sePaired,
          pass: a.clauses.L_LG.passImprove,
        },
        M_ALL: {
          d: a.clauses.M_ALL.deltaWorseAxMinusA0,
          se: a.clauses.M_ALL.sePairedBoot,
          pass: a.clauses.M_ALL.passNotWorsen,
        },
        S_ALL: {
          d: a.clauses.S_ALL.deltaWorseAxMinusA0,
          se: a.clauses.S_ALL.sePairedBoot,
          pass: a.clauses.S_ALL.passNotWorsen,
        },
      })),
      a0overall: absoluteByVariant.A0!.overall,
    },
    null,
    2,
  ),
);
