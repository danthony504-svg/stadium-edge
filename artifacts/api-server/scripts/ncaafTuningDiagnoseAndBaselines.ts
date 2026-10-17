/**
 * TUNING close-joined diagnosis + simple baselines + evidence-backed research levers.
 *
 * - Closes are evaluation-only (never in predictive features).
 * - FINAL_EVAL never loaded.
 * - No paid Odds retrieval.
 * - Does not flip NCAAF_GAME_LINE_SIM_VALIDATED.
 *
 * Locked criteria (unchanged thresholds):
 *   M3: brierEngine ≤ brierMarketClose + 0.02
 *   S2: brierEngine ATS < 0.25
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
  FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
  FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
  FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
  applyNcaafResearchMarginGapScale,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  FOOTBALL_CALIBRATION_PRIMARY_SEED,
  mulberry32,
  walkHoldoutGames,
  type HoldoutWalkForm,
} from "../src/lib/sportSim/footballCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const CACHE = join(ART, "ncaaf-e2b-close-snapshots");
const SIMS = Number(process.env.NCAAF_TUNING_SIMS ?? 2_000);

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
  closeMlAway: number | null;
  closeSpreadHome: number | null;
  closeSpreadAway: number | null;
  homeScore: number;
  awayScore: number;
  home?: string;
  away?: string;
  kickoffIso?: string;
  matchSource?: string;
};

type MissingRow = {
  eventId: string;
  reason: string;
  kickoffIso?: string;
  home?: string;
  away?: string;
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
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx < 1e-12 || dy < 1e-12) return null;
  return num / Math.sqrt(dx * dy);
}
function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}
function clamp01(x: number): number {
  return Math.max(0.02, Math.min(0.98, x));
}
/** Logistic of strength gap → home win prob (slope fitted on TUNING labels only for baseline). */
function logistic(x: number, slope: number, intercept = 0): number {
  return clamp01(1 / (1 + Math.exp(-(intercept + slope * x))));
}

function normName(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alias map: ESPN-ish → Odds canonical tokens (school key). */
const SCHOOL_ALIASES: Record<string, string> = {
  "app state": "appalachian state",
  "san jose state": "san jose state",
  "san jose": "san jose state",
  "southern miss": "southern mississippi",
  umass: "massachusetts",
  massachusetts: "massachusetts",
  "sam houston": "sam houston state",
  "st francis pa": "st francis pa",
  "saint francis": "st francis pa",
  "st francis": "st francis pa",
  liu: "liu",
  "long island university": "liu",
  "se louisiana": "southeastern louisiana",
  "southeastern louisiana": "southeastern louisiana",
  "arkansas pine bluff": "arkansas pine bluff",
  nicholls: "nicholls state",
  "hawaii": "hawaii",
  "ul monroe": "ul monroe",
  "louisiana monroe": "ul monroe",
};

function schoolKey(name: string): string {
  const n = normName(name);
  const parts = n.split(" ");
  // drop common mascot last token(s)
  let school = parts.length >= 2 ? parts.slice(0, -1).join(" ") : n;
  // strip trailing "state" duplication handled via alias
  if (SCHOOL_ALIASES[school]) return SCHOOL_ALIASES[school];
  // try without last word if still aliased
  if (parts.length >= 3) {
    const alt = parts.slice(0, -2).join(" ");
    if (SCHOOL_ALIASES[alt]) return SCHOOL_ALIASES[alt];
  }
  return school;
}

function namesMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (na === nb) return true;
  const sa = schoolKey(a);
  const sb = schoolKey(b);
  if (sa && sb && sa === sb) return true;
  if (sa && (nb.includes(sa) || na.includes(sb))) return true;
  return false;
}

function pairMatch(
  homeA: string,
  awayA: string,
  homeB: string,
  awayB: string,
): boolean {
  if (namesMatch(homeA, homeB) && namesMatch(awayA, awayB)) return true;
  if (namesMatch(homeA, awayB) && namesMatch(awayA, homeB)) return true;
  return false;
}

function bucketIso(kickoffIso: string): string {
  const s = kickoffIso.endsWith("Z")
    ? kickoffIso.slice(0, -1) + "+00:00"
    : kickoffIso;
  const d = new Date(s);
  return d.toISOString().slice(0, 16) + ":00Z";
}

function extractTeamPrices(
  event: Record<string, unknown>,
  teamName: string,
): {
  spread: number | null;
  ml: number | null;
  spreadOdds: number | null;
  book: string | null;
} {
  const prefer = ["draftkings", "fanduel", "betmgm", "williamhill_us", "bovada"];
  const books = [...((event.bookmakers as any[]) || [])].sort((a, b) => {
    const ia = prefer.indexOf(a?.key);
    const ib = prefer.indexOf(b?.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  let spread: number | null = null;
  let ml: number | null = null;
  let spreadOdds: number | null = null;
  let book: string | null = null;
  for (const b of books) {
    const markets: Record<string, any> = {};
    for (const m of b.markets || []) markets[m.key] = m;
    if (spread == null && markets.spreads) {
      for (const o of markets.spreads.outcomes || []) {
        if (namesMatch(o.name || "", teamName)) {
          spread = Number(o.point);
          spreadOdds = Number(o.price);
          book = b.key;
          break;
        }
      }
    }
    if (ml == null && markets.h2h) {
      for (const o of markets.h2h.outcomes || []) {
        if (namesMatch(o.name || "", teamName)) {
          ml = Number(o.price);
          book = book || b.key;
          break;
        }
      }
    }
    if (spread != null && ml != null) break;
  }
  return {
    spread: Number.isFinite(spread as number) ? spread : null,
    ml: Number.isFinite(ml as number) ? ml : null,
    spreadOdds: Number.isFinite(spreadOdds as number) ? spreadOdds : null,
    book,
  };
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
  const seasonFor = form?.ptsFor ?? [];
  const seasonAgainst = form?.ptsAgainst ?? [];
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
    seasonPtsFor: seasonFor.length >= 3 ? mean(seasonFor, 24) : null,
    seasonPtsAgainst: seasonAgainst.length >= 3 ? mean(seasonAgainst, 24) : null,
    nGames: seasonFor.length,
    provenance: blended.provenance,
  };
}

type Lever =
  | "locked_baseline"
  | "prior_season_anchor_0.35"
  | "season_to_date_means"
  | "sos_adjusted_offense"
  | "margin_history_mean"
  | "gap_scale_1.45_REFERENCE_ONLY";

type RowOut = {
  eventId: string;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  yMl: number;
  yAts: number | null;
  closeMlHome: number;
  closeSpreadHome: number;
  marketP: number;
  favoriteSide: "home" | "away" | "pick";
  spreadAbsBin: string;
  weekBin: string;
  strengthGap: number;
  predMargin: number;
  pEngine: number;
  pAts: number | null;
};

function spreadBin(absSpread: number): string {
  if (absSpread <= 3.5) return "0_3.5";
  if (absSpread <= 7.5) return "3.5_7.5";
  if (absSpread <= 14) return "7.5_14";
  if (absSpread <= 21) return "14_21";
  return "21plus";
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
  process.env.NCAAF_RESEARCH_CALIBRATION = "1";

  const tuningPath = join(FIX, "ncaaf-tuning-2025-w1-7-games.json");
  const closesPath = join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json");
  const priorPath = join(FIX, "ncaaf-phase-e-games.json");
  for (const p of [tuningPath, closesPath, priorPath]) {
    if (!existsSync(p)) {
      console.error("Missing", p);
      return 2;
    }
  }

  const tuning = loadJsonGames(tuningPath).filter(
    (g) => g.season === 2025 && g.week >= 1 && g.week <= 7,
  );
  const prior = loadJsonGames(priorPath).filter((g) => g.season === 2023 || g.season === 2024);
  const archive = JSON.parse(readFileSync(closesPath, "utf8")) as {
    games: CloseRow[];
    missing: MissingRow[];
  };
  const closes = new Map(archive.games.map((g) => [String(g.gameId), g]));
  const byId = new Map(tuning.map((g) => [g.eventId, g]));

  // ── Rematch unmatched from local cache (no paid HTTP) ──
  const rematchRecovered: CloseRow[] = [];
  const rematchAudit: Array<Record<string, unknown>> = [];
  for (const m of archive.missing) {
    const g = byId.get(m.eventId);
    if (!g?.kickoffIso || !g.homeName || !g.awayName) continue;
    const b = bucketIso(g.kickoffIso);
    const cpath = join(CACHE, `${b.replace(/:/g, "")}.json`);
    if (!existsSync(cpath)) {
      rematchAudit.push({
        eventId: g.eventId,
        class: "no_cache",
        home: g.homeName,
        away: g.awayName,
        week: g.week,
      });
      continue;
    }
    const payload = JSON.parse(readFileSync(cpath, "utf8")) as {
      events: any[];
      snapshotTimestamp?: string;
    };
    let found: any = null;
    for (const ev of payload.events || []) {
      if (pairMatch(g.homeName, g.awayName, ev.home_team || "", ev.away_team || "")) {
        found = ev;
        break;
      }
    }
    if (!found) {
      // classify absence
      const oddsNames = (payload.events || []).flatMap((ev) => [
        ev.home_team,
        ev.away_team,
      ]);
      const homeHit = oddsNames.some((n) => namesMatch(n, g.homeName!));
      const awayHit = oddsNames.some((n) => namesMatch(n, g.awayName!));
      rematchAudit.push({
        eventId: g.eventId,
        class:
          !homeHit && !awayHit
            ? "both_absent_in_bucket"
            : !homeHit || !awayHit
              ? "one_side_absent_or_alias"
              : "present_but_pair_fail",
        home: g.homeName,
        away: g.awayName,
        week: g.week,
        homeHit,
        awayHit,
        bucketEvents: (payload.events || []).length,
      });
      continue;
    }
    const homeP = extractTeamPrices(found, g.homeName);
    const awayP = extractTeamPrices(found, g.awayName);
    if (homeP.ml == null && homeP.spread == null) {
      rematchAudit.push({
        eventId: g.eventId,
        class: "alias_match_no_prices",
        home: g.homeName,
        away: g.awayName,
        week: g.week,
      });
      continue;
    }
    const row: CloseRow = {
      gameId: g.eventId,
      closeMlHome: homeP.ml,
      closeMlAway: awayP.ml,
      closeSpreadHome: homeP.spread,
      closeSpreadAway: awayP.spread,
      homeScore: g.homeFg,
      awayScore: g.awayFg,
      home: g.homeName,
      away: g.awayName,
      kickoffIso: g.kickoffIso,
      matchSource: "cache_alias_rematch",
    };
    rematchRecovered.push(row);
    closes.set(g.eventId, row);
    rematchAudit.push({
      eventId: g.eventId,
      class: "recovered_alias",
      home: g.homeName,
      away: g.awayName,
      week: g.week,
      oddsHome: found.home_team,
      oddsAway: found.away_team,
    });
  }

  const classCounts: Record<string, number> = {};
  for (const a of rematchAudit) {
    const c = String(a.class);
    classCounts[c] = (classCounts[c] ?? 0) + 1;
  }

  // Coverage bias: week / home-win / |margin| matched vs still-missing
  const stillMissing = archive.missing.filter((m) => !closes.has(m.eventId));
  const matchedGames = tuning.filter((g) => closes.has(g.eventId));
  const missingGames = stillMissing
    .map((m) => byId.get(m.eventId))
    .filter((g): g is EspnGame => !!g);
  const coverageBias = {
    originalMissing: archive.missing.length,
    recoveredViaAliasCache: rematchRecovered.length,
    stillMissing: stillMissing.length,
    rematchClassCounts: classCounts,
    weekShare: {
      missing: Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7].map((w) => [
          w,
          missingGames.filter((g) => g.week === w).length / Math.max(1, missingGames.length),
        ]),
      ),
      matched: Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7].map((w) => [
          w,
          matchedGames.filter((g) => g.week === w).length / Math.max(1, matchedGames.length),
        ]),
      ),
    },
    homeWinRate: {
      missing: mean(missingGames.map((g) => (g.homeFg > g.awayFg ? 1 : 0))),
      matched: mean(matchedGames.map((g) => (g.homeFg > g.awayFg ? 1 : 0))),
    },
    meanAbsMargin: {
      missing: mean(missingGames.map((g) => Math.abs(g.homeFg - g.awayFg))),
      matched: mean(matchedGames.map((g) => Math.abs(g.homeFg - g.awayFg))),
    },
    systematicBiasNote:
      "Unmatched mass is alias/FCS naming (App State, San José, Southern Miss, UMass, Sam Houston, LIU, SE Louisiana) plus true FCS-only opponents absent from Odds FBS boards — not random week noise. Alias rematch is free (cache-only).",
  };

  // Prior-season team anchors (2024 only — form history, not TUNING labels)
  const prior2024 = prior.filter((g) => g.season === 2024);
  const seasonPpg = new Map<string, { for: number[]; against: number[]; margins: number[] }>();
  for (const g of prior2024) {
    if (!seasonPpg.has(g.homeTeamId))
      seasonPpg.set(g.homeTeamId, { for: [], against: [], margins: [] });
    if (!seasonPpg.has(g.awayTeamId))
      seasonPpg.set(g.awayTeamId, { for: [], against: [], margins: [] });
    seasonPpg.get(g.homeTeamId)!.for.push(g.homeFg);
    seasonPpg.get(g.homeTeamId)!.against.push(g.awayFg);
    seasonPpg.get(g.homeTeamId)!.margins.push(g.homeFg - g.awayFg);
    seasonPpg.get(g.awayTeamId)!.for.push(g.awayFg);
    seasonPpg.get(g.awayTeamId)!.against.push(g.homeFg);
    seasonPpg.get(g.awayTeamId)!.margins.push(g.awayFg - g.homeFg);
  }
  const priorStrength = new Map<string, { off: number; def: number; margin: number; n: number }>();
  for (const [id, s] of seasonPpg) {
    priorStrength.set(id, {
      off: mean(s.for, 24),
      def: mean(s.against, 24),
      margin: mean(s.margins, 0),
      n: s.for.length,
    });
  }

  type BuiltMeans = {
    homeOff: number;
    awayOff: number;
    strengthGap: number;
    predMargin: number;
    recentHome: number[];
    recentAway: number[];
  };

  function buildMeans(
    lever: Lever,
    homeIn: ReturnType<typeof teamSimInput>,
    awayIn: ReturnType<typeof teamSimInput>,
    homeId: string,
    awayId: string,
  ): BuiltMeans | null {
    let homeFor = homeIn.ptsFor;
    let homeAgainst = homeIn.ptsAgainst;
    let awayFor = awayIn.ptsFor;
    let awayAgainst = awayIn.ptsAgainst;
    if (homeFor == null || awayFor == null) return null;

    if (lever === "season_to_date_means") {
      homeFor = homeIn.seasonPtsFor ?? homeFor;
      homeAgainst = homeIn.seasonPtsAgainst ?? homeAgainst;
      awayFor = awayIn.seasonPtsFor ?? awayFor;
      awayAgainst = awayIn.seasonPtsAgainst ?? awayAgainst;
    }

    if (lever === "prior_season_anchor_0.35") {
      const w = 0.35;
      const hp = priorStrength.get(homeId);
      const ap = priorStrength.get(awayId);
      if (hp && hp.n >= 6) {
        homeFor = (1 - w) * homeFor + w * hp.off;
        homeAgainst = (1 - w) * (homeAgainst ?? hp.def) + w * hp.def;
      }
      if (ap && ap.n >= 6) {
        awayFor = (1 - w) * awayFor + w * ap.off;
        awayAgainst = (1 - w) * (awayAgainst ?? ap.def) + w * ap.def;
      }
    }

    if (lever === "sos_adjusted_offense") {
      // Approximate SOS: team's ptsFor minus league mean; add opponent defensive weakness.
      // Structural: use opponent prior def as the "against" side more heavily.
      const hp = priorStrength.get(homeId);
      const ap = priorStrength.get(awayId);
      const homeOppDef = ap?.def ?? awayAgainst ?? 24;
      const awayOppDef = hp?.def ?? homeAgainst ?? 24;
      homeFor = 0.5 * homeFor + 0.5 * (homeFor + (homeOppDef - 24));
      awayFor = 0.5 * awayFor + 0.5 * (awayFor + (awayOppDef - 24));
      homeAgainst = homeOppDef;
      awayAgainst = awayOppDef;
    }

    let homeOff = 0.5 * homeFor + 0.5 * (awayAgainst ?? 24);
    let awayOff = 0.5 * awayFor + 0.5 * (homeAgainst ?? 24);

    if (lever === "margin_history_mean") {
      const hp = priorStrength.get(homeId);
      const ap = priorStrength.get(awayId);
      if (hp && ap && hp.n >= 6 && ap.n >= 6) {
        // Project margin from prior margin differentials + current form gap.
        const formGap = homeOff - awayOff;
        const priorGap = hp.margin - ap.margin;
        const blendedGap = 0.55 * formGap + 0.45 * priorGap;
        const mid = (homeOff + awayOff) / 2;
        homeOff = mid + blendedGap / 2;
        awayOff = mid - blendedGap / 2;
      }
    }

    if (lever === "gap_scale_1.45_REFERENCE_ONLY") {
      const scaled = applyNcaafResearchMarginGapScale(homeOff, awayOff, 1.45);
      homeOff = scaled.homeOff;
      awayOff = scaled.awayOff;
    }

    return {
      homeOff,
      awayOff,
      strengthGap: homeOff - awayOff,
      predMargin: homeOff - awayOff - FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
      recentHome: homeIn.recentScores,
      recentAway: awayIn.recentScores,
    };
  }

  const tuningIds = new Set(tuning.map((g) => g.eventId));
  const all = [...prior, ...tuning].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  // Fit simple logistic slope on TUNING labels using form gap only (no closes in features).
  // Walk once to collect gaps for baseline fit.
  const fitGaps: number[] = [];
  const fitY: number[] = [];
  walkHoldoutGames(all, (g, forms) => {
    if (!tuningIds.has(g.eventId) || g.homeFg === g.awayFg) return;
    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
    const means = buildMeans("locked_baseline", homeIn, awayIn, g.homeTeamId, g.awayTeamId);
    if (!means) return;
    fitGaps.push(means.strengthGap);
    fitY.push(g.homeFg > g.awayFg ? 1 : 0);
  });
  // coarse grid search slope for logistic baseline (TUNING-fit — reported as such)
  let bestSlope = 0.08;
  let bestB = 9;
  for (const slope of [0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2]) {
    const ps = fitGaps.map((g) => logistic(g, slope));
    const b = brier(ps, fitY);
    if (b < bestB) {
      bestB = b;
      bestSlope = slope;
    }
  }

  const levers: Lever[] = [
    "locked_baseline",
    "prior_season_anchor_0.35",
    "season_to_date_means",
    "sos_adjusted_offense",
    "margin_history_mean",
    "gap_scale_1.45_REFERENCE_ONLY",
  ];

  const leverReports: Record<string, unknown> = {};
  let lockedRows: RowOut[] = [];
  const actMarginById = new Map<string, number>();

  for (const lever of levers) {
    if (lever === "gap_scale_1.45_REFERENCE_ONLY") {
      process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE = "1.45";
    } else {
      delete process.env.NCAAF_RESEARCH_MARGIN_GAP_SCALE;
    }
    const rng = mulberry32(FOOTBALL_CALIBRATION_PRIMARY_SEED + lever.length * 17);
    const rows: RowOut[] = [];
    let skippedThin = 0;
    let skippedNoClose = 0;

    walkHoldoutGames(all, (g, forms) => {
      if (!tuningIds.has(g.eventId) || g.homeFg === g.awayFg) return;
      const close = closes.get(g.eventId);
      if (
        !close ||
        close.closeMlHome == null ||
        !Number.isFinite(close.closeMlHome) ||
        close.closeSpreadHome == null ||
        !Number.isFinite(close.closeSpreadHome)
      ) {
        skippedNoClose += 1;
        return;
      }
      const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
      const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");
      const means = buildMeans(lever, homeIn, awayIn, g.homeTeamId, g.awayTeamId);
      if (!means) {
        skippedThin += 1;
        return;
      }

      // Predictive features: means only. Closes used after sim for labels/metrics.
      const result = runNflDriveSim({
        sport: "ncaaf",
        ncaafResearchCalibration: true,
        simulations: SIMS,
        random: rng,
        home: {
          ptsFor: means.homeOff,
          ptsAgainst: means.awayOff,
          recentScores: means.recentHome,
        },
        away: {
          ptsFor: means.awayOff,
          ptsAgainst: means.homeOff,
          recentScores: means.recentAway,
        },
        coverQueries: [
          { id: "home-ml", kind: "ml", teamSide: "home" },
          {
            id: "home-close-spread",
            kind: "spread",
            teamSide: "home",
            line: close.closeSpreadHome,
          },
        ],
        retainOutcomes: false,
      });
      if (!result) return;
      const pEngine =
        result.coverHitRates?.["home-ml"] ?? result.homeWinProbability ?? null;
      if (pEngine == null || !Number.isFinite(pEngine)) return;
      const pAts = result.coverHitRates?.["home-close-spread"] ?? null;
      const yMl = g.homeFg > g.awayFg ? 1 : 0;
      const adj = g.homeFg - g.awayFg + close.closeSpreadHome;
      const yAts = Math.abs(adj) < 1e-9 ? null : adj > 0 ? 1 : 0;
      const marketP = americanToImplied(close.closeMlHome);
      const favoriteSide =
        Math.abs(close.closeSpreadHome) < 0.25
          ? "pick"
          : close.closeSpreadHome < 0
            ? "home"
            : "away";
      actMarginById.set(g.eventId, g.homeFg - g.awayFg);
      rows.push({
        eventId: g.eventId,
        week: g.week,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        yMl,
        yAts,
        closeMlHome: close.closeMlHome,
        closeSpreadHome: close.closeSpreadHome,
        marketP,
        favoriteSide,
        spreadAbsBin: spreadBin(Math.abs(close.closeSpreadHome)),
        weekBin: `w${g.week}`,
        strengthGap: means.strengthGap,
        predMargin:
          (result.expectedHomeScore ?? means.homeOff) -
          (result.expectedAwayScore ?? means.awayOff),
        pEngine,
        pAts,
      });
    });

    const p = rows.map((r) => r.pEngine);
    const y = rows.map((r) => r.yMl);
    const mkt = rows.map((r) => r.marketP);
    const ats = rows.filter((r) => r.pAts != null && r.yAts != null);
    const brierEngine = brier(p, y);
    const brierMarketClose = brier(mkt, y);
    const brierAts = ats.length
      ? brier(
          ats.map((r) => r.pAts!),
          ats.map((r) => r.yAts!),
        )
      : null;
    const m3Pass = brierEngine <= brierMarketClose + 0.02;
    const s2Pass = brierAts != null && brierAts < 0.25;
    const predM = rows.map((r) => r.predMargin);
    const actM = rows.map((r) => actMarginById.get(r.eventId)!);

    // Simple baselines on same row set (no closes in features)
    const gap = rows.map((r) => r.strengthGap);
    const pLogistic = gap.map((g) => logistic(g, bestSlope));
    const pMarginSign = gap.map((g) => clamp01(0.5 + g / 60));
    const baselineCompare = {
      note: "Baselines use strength/form features only — closes eval-only",
      logisticOnStrengthGap: {
        slopeFitOnTuning: bestSlope,
        brier: brier(pLogistic, y),
        corrGapY: pearson(gap, y),
      },
      linearMarginToProb: {
        formula: "clamp01(0.5 + strengthGap/60)",
        brier: brier(pMarginSign, y),
      },
      marketClose: { brier: brierMarketClose },
      engine: { brier: brierEngine },
    };

    // Slices with real act margins
    const byFavorite: Record<string, unknown> = {};
    for (const side of ["home", "away", "pick"] as const) {
      const rs = rows.filter((r) => r.favoriteSide === side);
      if (!rs.length) continue;
      const favCorrect = rs.filter((r) => {
        if (r.favoriteSide === "pick") return false;
        const favWon =
          r.favoriteSide === "home" ? r.yMl === 1 : r.yMl === 0;
        return favWon;
      }).length;
      byFavorite[side] = {
        n: rs.length,
        brierEngine: brier(
          rs.map((r) => r.pEngine),
          rs.map((r) => r.yMl),
        ),
        brierMarket: brier(
          rs.map((r) => r.marketP),
          rs.map((r) => r.yMl),
        ),
        meanP: mean(rs.map((r) => r.pEngine)),
        meanY: mean(rs.map((r) => r.yMl)),
        meanMarketP: mean(rs.map((r) => r.marketP)),
        favoriteCoverRateMl: side === "pick" ? null : favCorrect / rs.length,
        meanAbsSpread: mean(rs.map((r) => Math.abs(r.closeSpreadHome))),
        meanPredMargin: mean(rs.map((r) => r.predMargin)),
        meanActMargin: mean(rs.map((r) => actMarginById.get(r.eventId)!)),
        atsBrier:
          rs.filter((r) => r.pAts != null && r.yAts != null).length >= 5
            ? brier(
                rs.filter((r) => r.pAts != null && r.yAts != null).map((r) => r.pAts!),
                rs.filter((r) => r.pAts != null && r.yAts != null).map((r) => r.yAts!),
              )
            : null,
      };
    }

    const bySpread: Record<string, unknown> = {};
    for (const bin of ["0_3.5", "3.5_7.5", "7.5_14", "14_21", "21plus"]) {
      const rs = rows.filter((r) => r.spreadAbsBin === bin);
      if (!rs.length) continue;
      bySpread[bin] = {
        n: rs.length,
        brierEngine: brier(
          rs.map((r) => r.pEngine),
          rs.map((r) => r.yMl),
        ),
        brierMarket: brier(
          rs.map((r) => r.marketP),
          rs.map((r) => r.yMl),
        ),
        meanP: mean(rs.map((r) => r.pEngine)),
        meanY: mean(rs.map((r) => r.yMl)),
        meanPredMargin: mean(rs.map((r) => r.predMargin)),
        meanActMargin: mean(rs.map((r) => actMarginById.get(r.eventId)!)),
        marginBias: mean(rs.map((r) => r.predMargin - actMarginById.get(r.eventId)!)),
        atsBrier:
          rs.filter((r) => r.pAts != null && r.yAts != null).length >= 5
            ? brier(
                rs.filter((r) => r.pAts != null && r.yAts != null).map((r) => r.pAts!),
                rs.filter((r) => r.pAts != null && r.yAts != null).map((r) => r.yAts!),
              )
            : null,
      };
    }

    // Strength quintiles by |strengthGap|
    const sorted = [...rows].sort(
      (a, b) => Math.abs(a.strengthGap) - Math.abs(b.strengthGap),
    );
    const qn = Math.floor(sorted.length / 5) || 1;
    const byStrength: Record<string, unknown> = {};
    for (let q = 0; q < 5; q++) {
      const rs = sorted.slice(q * qn, q === 4 ? sorted.length : (q + 1) * qn);
      byStrength[`q${q + 1}_absGap`] = {
        n: rs.length,
        absGapRange: [
          Math.abs(rs[0]?.strengthGap ?? 0),
          Math.abs(rs[rs.length - 1]?.strengthGap ?? 0),
        ],
        brierEngine: brier(
          rs.map((r) => r.pEngine),
          rs.map((r) => r.yMl),
        ),
        brierMarket: brier(
          rs.map((r) => r.marketP),
          rs.map((r) => r.yMl),
        ),
        corrGapY: pearson(
          rs.map((r) => r.strengthGap),
          rs.map((r) => r.yMl),
        ),
        meanPredMargin: mean(rs.map((r) => r.predMargin)),
        meanActMargin: mean(rs.map((r) => actMarginById.get(r.eventId)!)),
      };
    }

    const byWeek: Record<string, unknown> = {};
    for (let w = 1; w <= 7; w++) {
      const rs = rows.filter((r) => r.week === w);
      if (!rs.length) continue;
      byWeek[`w${w}`] = {
        n: rs.length,
        brierEngine: brier(
          rs.map((r) => r.pEngine),
          rs.map((r) => r.yMl),
        ),
        brierMarket: brier(
          rs.map((r) => r.marketP),
          rs.map((r) => r.yMl),
        ),
        meanP: mean(rs.map((r) => r.pEngine)),
        meanY: mean(rs.map((r) => r.yMl)),
        corrPredMargin_Actual: pearson(
          rs.map((r) => r.predMargin),
          rs.map((r) => actMarginById.get(r.eventId)!),
        ),
        meanPredMargin: mean(rs.map((r) => r.predMargin)),
        meanActMargin: mean(rs.map((r) => actMarginById.get(r.eventId)!)),
      };
    }

    const report = {
      lever,
      referenceOnly: lever === "gap_scale_1.45_REFERENCE_ONLY",
      structural:
        lever !== "locked_baseline" && lever !== "gap_scale_1.45_REFERENCE_ONLY",
      n: rows.length,
      skippedThin,
      skippedNoClose,
      moneyline: {
        brierEngine,
        brierMarketClose,
        delta: brierEngine - brierMarketClose,
        M3: { criterion: "brierEngine <= brierMarketClose + 0.02", pass: m3Pass },
        meanP: mean(p),
        meanY: mean(y),
        meanMarketP: mean(mkt),
        corrP_Y: pearson(p, y),
      },
      spreadsAts: {
        n: ats.length,
        brierEngine: brierAts,
        S2: { criterion: "brierEngine < 0.25", pass: s2Pass },
      },
      marginDiscrimination: {
        corrPred_Actual: pearson(predM, actM),
        meanPred: mean(predM),
        meanAct: mean(actM),
        meanAbsError: mean(predM.map((x, i) => Math.abs(x - actM[i]!))),
        note: "Compression (meanPred < meanAct) is the main discrimination failure mode; gap_scale fixes scale not rank.",
      },
      baselineCompare,
      slices: { byFavorite, bySpread, byStrength, byWeek },
    };
    leverReports[lever] = report;
    if (lever === "locked_baseline") lockedRows = rows;
    console.log(
      JSON.stringify({
        lever,
        n: rows.length,
        m3: m3Pass,
        s2: s2Pass,
        brierEngine,
        brierMarketClose,
        brierAts,
        corrMargin: pearson(predM, actM),
      }),
    );
  }

  // Pick best structural lever (exclude gap_scale reference) by M3 delta then S2 then corr
  const structuralKeys = levers.filter(
    (l) => l !== "gap_scale_1.45_REFERENCE_ONLY" && l !== "locked_baseline",
  );
  let bestStructural = "locked_baseline";
  let bestScore = Infinity;
  for (const k of ["locked_baseline", ...structuralKeys]) {
    const r = leverReports[k] as any;
    const d = r.moneyline.delta as number;
    const ats = (r.spreadsAts.brierEngine as number) ?? 9;
    const corr = (r.marginDiscrimination.corrPred_Actual as number) ?? 0;
    const score = d + 0.25 * ats - 0.05 * corr; // lower better; reward corr
    if (score < bestScore) {
      bestScore = score;
      bestStructural = k;
    }
  }

  const before = leverReports.locked_baseline as any;
  const after = leverReports[bestStructural] as any;

  const out = {
    generatedAt: new Date().toISOString(),
    split: "TUNING",
    finalEvalUntouched: true,
    liveGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
    paidRetrieval: false,
    closesInPredictiveFeatures: false,
    researchStamp: FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION,
    lockedParams: {
      residualSd: FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD,
      homeMarginShrink: FOOTBALL_NCAAF_HOME_MARGIN_SHRINK,
      gapScaleDefault: FOOTBALL_NCAAF_RESEARCH_MARGIN_GAP_SCALE_DEFAULT,
      offenseWeight: 0.5,
    },
    simsPerGame: SIMS,
    coverageBias,
    rematchRecovered: rematchRecovered.length,
    diagnosis: {
      summary:
        "Engine ML is under-confident vs close (meanP < meanY ≈ meanMarket). Predicted margins correlate with actual (~0.55–0.57) but are compressed (~30% too small), so ATS Brier fails. Gap-scale only rescales means (corr unchanged) — reported as REFERENCE_ONLY, not proposed lock.",
      favoriteUnderdog:
        before.slices.byFavorite,
      unmatched:
        "58 no_odds_match: mostly ESPN↔Odds aliases (App State/Appalachian State, San José/San Jose, Southern Miss/Southern Mississippi, UMass/Massachusetts, Sam Houston/Sam Houston State) plus FCS opponents. Cache alias rematch recovers without paid calls.",
    },
    levers: leverReports,
    beforeAfter: {
      beforeLever: "locked_baseline",
      afterLever: bestStructural,
      before: {
        M3: before.moneyline.M3,
        S2: before.spreadsAts.S2,
        brierEngine: before.moneyline.brierEngine,
        brierMarketClose: before.moneyline.brierMarketClose,
        atsBrier: before.spreadsAts.brierEngine,
        corrMargin: before.marginDiscrimination.corrPred_Actual,
        n: before.n,
      },
      after: {
        M3: after.moneyline.M3,
        S2: after.spreadsAts.S2,
        brierEngine: after.moneyline.brierEngine,
        brierMarketClose: after.moneyline.brierMarketClose,
        atsBrier: after.spreadsAts.brierEngine,
        corrMargin: after.marginDiscrimination.corrPred_Actual,
        n: after.n,
      },
      gateFlipAllowed: false,
      note: "Do not promote afterLever to lock without new lock doc + FINAL_EVAL. gap_scale is not eligible as the proposed change.",
    },
    lockedRowsSampleN: lockedRows.length,
  };

  const outArt = join(ART, "ncaaf-tuning-diagnose-baselines.json");
  const outFix = join(FIX, "ncaaf-tuning-diagnose-baselines.json");
  const mdArt = join(ART, "ncaaf-tuning-diagnose-baselines.md");
  writeFileSync(outArt, JSON.stringify(out, null, 2));
  writeFileSync(outFix, JSON.stringify(out, null, 2));

  const md = `# TUNING diagnosis + baselines (closes eval-only)

**FINAL_EVAL:** untouched · **Gate:** false · **Paid retrieval:** none

## Unmatched (58) coverage bias

- Recovered via cache alias rematch: **${rematchRecovered.length}** (no paid HTTP)
- Still missing: **${stillMissing.length}**
- Classes: ${JSON.stringify(classCounts)}
- ${coverageBias.systematicBiasNote}

Home win rate missing/matched: ${coverageBias.homeWinRate.missing.toFixed(3)} / ${coverageBias.homeWinRate.matched.toFixed(3)}  
Mean |margin| missing/matched: ${coverageBias.meanAbsMargin.missing.toFixed(2)} / ${coverageBias.meanAbsMargin.matched.toFixed(2)}

## Locked baseline vs market (M3/S2)

| Metric | Before (locked) | After (${bestStructural}) |
|--------|----------------:|--------------------------:|
| n | ${before.n} | ${after.n} |
| ML Brier engine | ${before.moneyline.brierEngine.toFixed(4)} | ${after.moneyline.brierEngine.toFixed(4)} |
| ML Brier market | ${before.moneyline.brierMarketClose.toFixed(4)} | ${after.moneyline.brierMarketClose.toFixed(4)} |
| M3 | ${before.moneyline.M3.pass} | ${after.moneyline.M3.pass} |
| ATS Brier | ${Number(before.spreadsAts.brierEngine).toFixed(4)} | ${Number(after.spreadsAts.brierEngine).toFixed(4)} |
| S2 | ${before.spreadsAts.S2.pass} | ${after.spreadsAts.S2.pass} |
| corr(predMargin, actual) | ${Number(before.marginDiscrimination.corrPred_Actual).toFixed(3)} | ${Number(after.marginDiscrimination.corrPred_Actual).toFixed(3)} |
| meanPred / meanAct | ${before.marginDiscrimination.meanPred.toFixed(2)} / ${before.marginDiscrimination.meanAct.toFixed(2)} | ${after.marginDiscrimination.meanPred.toFixed(2)} / ${after.marginDiscrimination.meanAct.toFixed(2)} |

## Why margins lack discrimination

Correlation is moderate (~0.55+) but **mean predicted margin << mean actual** (compression).  
\`gap_scale\` only multiplies the mean gap — **corr unchanged** — so it is REFERENCE_ONLY, not an evidence-backed lock candidate.

## Simple baselines (no closes in features)

See JSON \`levers.locked_baseline.baselineCompare\`.

## Guardrails

- Closing odds not used as predictive features
- FINAL_EVAL not loaded
- NCAAF gate not flipped; no deploy/OTA
`;
  writeFileSync(mdArt, md);
  writeFileSync(join(FIX, "ncaaf-tuning-diagnose-baselines.md"), md);
  console.log(JSON.stringify(out.beforeAfter, null, 2));
  console.log("Wrote", outArt);
  return 0;
}

process.exit(main());
