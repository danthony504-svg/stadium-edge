/**
 * Phase E — Coach pick CLV on historical selection-time prices.
 *
 * For each in-scope game:
 *  1. Form inputs use only games strictly before kickoff (no leakage).
 *  2. Selection-time prices come from Odds API historical snaps ~24h pre-kickoff
 *     (cached under /opt/cursor/artifacts/ncaaf-e2b-early-snapshots).
 *  3. Run nfl-drive with coverQueries for BOTH sides (ML + spread) at those prices.
 *  4. Qualify with Coach sim gates (edge/EV/simHit/confidence) — NOT blanket home.
 *  5. Pick the best qualifying side; measure CLV vs close and outcome.
 *
 * Untouched later period: market-close baseline only (no Coach picks).
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED. NCAAF P0 stays armed in product;
 * this offline run evaluates the sim+qualify path for research only.
 *
 * Env:
 *   NCAAF_PHASE_E_SIMS — default 10000 (required for final validation)
 *   NCAAF_COACH_CLV_CUTOFF — ISO date; games before = selection period (default 2024-10-15)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import { blendVenueAndL10 } from "../src/lib/sportSim/footballDriveMatchup.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const EARLY_CACHE = join(ART, "ncaaf-e2b-early-snapshots");

const SIMS = Number(process.env.NCAAF_PHASE_E_SIMS ?? 10_000);
const CUTOFF = process.env.NCAAF_COACH_CLV_CUTOFF ?? "2024-10-15T00:00:00Z";
const GAME_SIM_MIN_HIT = 0.52;
const COACH_SIM_MIN_CONFIDENCE = 52;

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
  home: string;
  away: string;
  kickoffIso: string;
  oddsCommenceTime?: string;
  closeSpreadHome: number | null;
  closeMlHome: number | null;
  homeScore: number;
  awayScore: number;
  closeSnapshotTimestamp?: string;
};

type TeamForm = {
  ptsFor: number[];
  ptsAgainst: number[];
  homeFor: number[];
  homeAgainst: number[];
  awayFor: number[];
  awayAgainst: number[];
};

type Cand = {
  id: string;
  market: "ml" | "spread";
  side: "home" | "away";
  line?: number;
  odds: number;
  simHit: number;
  edgePct: number;
  evPct: number;
  implied: number;
};

function mean(xs: number[], fb = 0): number {
  if (!xs.length) return fb;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function mlToProb(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

function americanToDecimal(american: number): number {
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / -american;
}

function fold(s: string): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\bmassachusetts\b/g, "umass")
    .replace(/\s+/g, " ")
    .trim();
}

function school(s: string): string {
  const p = fold(s).split(" ");
  return p.length >= 2 ? p.slice(0, -1).join(" ") : fold(s);
}

function parseIso(iso: string): number {
  const s = iso.endsWith("Z") ? iso.slice(0, -1) + "+00:00" : iso;
  return Date.parse(s);
}

function loadGames(): EspnGame[] {
  const raw = JSON.parse(
    readFileSync(join(FIX, "ncaaf-phase-e-games.json"), "utf8"),
  ) as { games: EspnGame[] };
  return raw.games
    .filter((g) => g.season === 2024 && g.kickoffIso)
    .sort((a, b) => String(a.kickoffIso).localeCompare(String(b.kickoffIso)));
}

function loadCloses(): Map<string, CloseRow> {
  const raw = JSON.parse(
    readFileSync(join(FIX, "ncaaf-phase-e-closing-lines.json"), "utf8"),
  ) as { games: CloseRow[] };
  const m = new Map<string, CloseRow>();
  for (const g of raw.games ?? []) m.set(String(g.gameId), g);
  return m;
}

/** Index early snapshot events by folded home|away. */
function loadEarlyIndex(): Map<
  string,
  { snap: string; event: Record<string, unknown> }
> {
  const idx = new Map<string, { snap: string; event: Record<string, unknown> }>();
  if (!existsSync(EARLY_CACHE)) return idx;
  for (const name of readdirSync(EARLY_CACHE)) {
    if (!name.endsWith(".json")) continue;
    const payload = JSON.parse(
      readFileSync(join(EARLY_CACHE, name), "utf8"),
    ) as {
      snapshotTimestamp?: string;
      events?: Array<Record<string, unknown>>;
    };
    const snap = payload.snapshotTimestamp ?? "";
    for (const ev of payload.events ?? []) {
      const h = fold(String(ev.home_team ?? ""));
      const a = fold(String(ev.away_team ?? ""));
      const key = `${h}|${a}`;
      const prev = idx.get(key);
      // Prefer later snap still before we'd use it; store all under both orders
      if (!prev || (snap && snap > prev.snap)) {
        idx.set(key, { snap, event: ev });
        idx.set(`${a}|${h}`, { snap, event: ev });
      }
    }
  }
  return idx;
}

function findEarly(
  idx: Map<string, { snap: string; event: Record<string, unknown> }>,
  home: string,
  away: string,
): { snap: string; event: Record<string, unknown> } | null {
  const hk = fold(home);
  const ak = fold(away);
  const sh = school(home);
  const sa = school(away);
  const direct = idx.get(`${hk}|${ak}`);
  if (direct) return direct;
  for (const [k, v] of idx) {
    const [eh, ea] = k.split("|");
    if (!eh || !ea) continue;
    if (
      (eh.includes(sh) || sh.includes(school(eh))) &&
      (ea.includes(sa) || sa.includes(school(ea)))
    ) {
      return v;
    }
  }
  return null;
}

function extractSidePrices(
  event: Record<string, unknown>,
  homeName: string,
  awayName: string,
): {
  homeMl: number | null;
  awayMl: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
} {
  const prefer = ["draftkings", "fanduel", "betmgm", "williamhill_us", "bovada"];
  const books = [...((event.bookmakers as Array<Record<string, unknown>>) ?? [])];
  books.sort((a, b) => {
    const ka = prefer.indexOf(String(a.key));
    const kb = prefer.indexOf(String(b.key));
    return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
  });
  const wantH = fold(homeName);
  const wantA = fold(awayName);
  let homeMl: number | null = null;
  let awayMl: number | null = null;
  let homeSpread: number | null = null;
  let awaySpread: number | null = null;
  let homeSpreadOdds: number | null = null;
  let awaySpreadOdds: number | null = null;

  const match = (name: string, want: string) => {
    const n = fold(name);
    return n === want || n.includes(want) || want.includes(n);
  };

  for (const b of books) {
    const markets = ((b.markets as Array<Record<string, unknown>>) ?? []).reduce(
      (acc, m) => {
        acc[String(m.key)] = m;
        return acc;
      },
      {} as Record<string, Record<string, unknown>>,
    );
    if (markets.h2h) {
      for (const o of (markets.h2h.outcomes as Array<Record<string, unknown>>) ?? []) {
        if (homeMl == null && match(String(o.name), wantH)) homeMl = Number(o.price);
        if (awayMl == null && match(String(o.name), wantA)) awayMl = Number(o.price);
      }
    }
    if (markets.spreads) {
      for (const o of (markets.spreads.outcomes as Array<Record<string, unknown>>) ??
        []) {
        if (homeSpread == null && match(String(o.name), wantH)) {
          homeSpread = Number(o.point);
          homeSpreadOdds = Number(o.price);
        }
        if (awaySpread == null && match(String(o.name), wantA)) {
          awaySpread = Number(o.point);
          awaySpreadOdds = Number(o.price);
        }
      }
    }
    if (
      homeMl != null &&
      awayMl != null &&
      homeSpread != null &&
      awaySpread != null
    ) {
      break;
    }
  }
  return { homeMl, awayMl, homeSpread, awaySpread, homeSpreadOdds, awaySpreadOdds };
}

function formSlice(form: TeamForm | undefined, n = 10) {
  const pf = form?.ptsFor.slice(-n) ?? [];
  const pa = form?.ptsAgainst.slice(-n) ?? [];
  if (pf.length < 2) {
    return { ptsFor: null as number | null, ptsAgainst: null as number | null, recentScores: pf.slice(), games: pf.length };
  }
  return {
    ptsFor: mean(pf, 24),
    ptsAgainst: mean(pa, 24),
    recentScores: pf.slice(),
    games: pf.length,
  };
}

function venueSlice(forArr?: number[], againstArr?: number[], n = 10) {
  const pf = (forArr ?? []).slice(-n);
  const pa = (againstArr ?? []).slice(-n);
  if (!pf.length) return { games: 0, ptsFor: null as number | null, ptsAgainst: null as number | null };
  return { games: pf.length, ptsFor: mean(pf, 24), ptsAgainst: pa.length ? mean(pa, 24) : null };
}

function teamSimInput(form: TeamForm | undefined, venue: "home" | "away") {
  const l10 = formSlice(form);
  const vf =
    venue === "home"
      ? venueSlice(form?.homeFor, form?.homeAgainst)
      : venueSlice(form?.awayFor, form?.awayAgainst);
  const blended = blendVenueAndL10(
    { games: vf.games, ptsFor: vf.ptsFor, ptsAgainst: vf.ptsAgainst },
    { games: l10.games, ptsFor: l10.ptsFor, ptsAgainst: l10.ptsAgainst },
  );
  return {
    ptsFor: blended.ptsFor,
    ptsAgainst: blended.ptsAgainst,
    recentScores: l10.recentScores,
  };
}

function qualify(simHit: number, odds: number, confidenceScore: number): Cand | null {
  if (!(simHit >= GAME_SIM_MIN_HIT)) return null;
  if (!(confidenceScore >= COACH_SIM_MIN_CONFIDENCE)) return null;
  const implied = mlToProb(odds);
  if (!(simHit > implied)) return null;
  const edgePct = Math.round((simHit - implied) * 1000) / 10;
  const evPct = Math.round((simHit * americanToDecimal(odds) - 1) * 1000) / 10;
  if (!(edgePct > 0) || !(evPct > 0)) return null;
  return {
    id: "",
    market: "ml",
    side: "home",
    odds,
    simHit,
    edgePct,
    evPct,
    implied,
  };
}

/** CLV in probability points for the selected American price vs close price on same side. */
function mlClv(selectionOdds: number, closeOdds: number): number {
  return mlToProb(closeOdds) - mlToProb(selectionOdds);
}

function main(): number {
  console.log("══ NCAAF Phase E Coach pick CLV (selection-time) ══");
  console.log(`sims=${SIMS} cutoff=${CUTOFF}`);
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped.");
  console.log("Selection is NOT blanket-home — both sides compete under Coach sim gates.");

  if (SIMS < 10_000) {
    console.error("FINAL validation requires NCAAF_PHASE_E_SIMS>=10000");
    return 2;
  }

  const games = loadGames();
  const closes = loadCloses();
  const earlyIdx = loadEarlyIndex();
  console.log(
    `games=${games.length} closes=${closes.size} earlyIndexKeys=${earlyIdx.size}`,
  );

  const cutoffMs = parseIso(CUTOFF);
  const forms = new Map<string, TeamForm>();
  const empty = (): TeamForm => ({
    ptsFor: [],
    ptsAgainst: [],
    homeFor: [],
    homeAgainst: [],
    awayFor: [],
    awayAgainst: [],
  });

  type PickRow = {
    gameId: string;
    week: number;
    kickoffIso: string;
    selectionTimestamp: string;
    market: string;
    side: string;
    line: number | null;
    selectionOdds: number;
    closeOdds: number | null;
    simHit: number;
    edgePct: number;
    evPct: number;
    clvProbPoints: number | null;
    spreadClvPoints: number | null;
    won: boolean | null;
    covered: boolean | null;
    candidatesQualified: number;
  };

  const picks: PickRow[] = [];
  let skippedNoClose = 0;
  let skippedNoEarly = 0;
  let skippedThinForm = 0;
  let skippedNoQualify = 0;
  let selectionUniverse = 0;
  let baselineUniverse = 0;

  // Market baseline on untouched period (close ML Brier only)
  const baseP: number[] = [];
  const baseY: number[] = [];

  for (const g of games) {
    const kickMs = parseIso(String(g.kickoffIso));
    const inSelection = kickMs < cutoffMs;
    const close = closes.get(String(g.eventId));

    const homeIn = teamSimInput(forms.get(g.homeTeamId), "home");
    const awayIn = teamSimInput(forms.get(g.awayTeamId), "away");

    // Update form AFTER using it
    const updateForm = () => {
      const hf = forms.get(g.homeTeamId) ?? empty();
      hf.ptsFor.push(g.homeFg);
      hf.ptsAgainst.push(g.awayFg);
      hf.homeFor.push(g.homeFg);
      hf.homeAgainst.push(g.awayFg);
      forms.set(g.homeTeamId, hf);
      const af = forms.get(g.awayTeamId) ?? empty();
      af.ptsFor.push(g.awayFg);
      af.ptsAgainst.push(g.homeFg);
      af.awayFor.push(g.awayFg);
      af.awayAgainst.push(g.homeFg);
      forms.set(g.awayTeamId, af);
    };

    if (!inSelection) {
      // Untouched period — market baseline only
      if (
        close?.closeMlHome != null &&
        Number.isFinite(close.closeMlHome) &&
        g.homeFg !== g.awayFg
      ) {
        baselineUniverse += 1;
        baseP.push(mlToProb(Number(close.closeMlHome)));
        baseY.push(g.homeFg > g.awayFg ? 1 : 0);
      }
      updateForm();
      continue;
    }

    // Selection period — competition scope = Odds-listed closes only
    if (!close || close.closeMlHome == null || close.closeSpreadHome == null) {
      skippedNoClose += 1;
      updateForm();
      continue;
    }
    selectionUniverse += 1;

    if (homeIn.ptsFor == null || awayIn.ptsFor == null) {
      skippedThinForm += 1;
      updateForm();
      continue;
    }

    const early = findEarly(earlyIdx, g.homeName ?? "", g.awayName ?? "");
    if (!early) {
      skippedNoEarly += 1;
      updateForm();
      continue;
    }
    // Selection snap must be before commence
    const commence = close.oddsCommenceTime ?? g.kickoffIso!;
    if (early.snap && early.snap >= commence) {
      skippedNoEarly += 1;
      updateForm();
      continue;
    }

    const prices = extractSidePrices(
      early.event,
      g.homeName ?? "",
      g.awayName ?? "",
    );
    if (
      prices.homeMl == null ||
      prices.awayMl == null ||
      prices.homeSpread == null ||
      prices.awaySpread == null
    ) {
      skippedNoEarly += 1;
      updateForm();
      continue;
    }
    const homeSpOdds = prices.homeSpreadOdds ?? -110;
    const awaySpOdds = prices.awaySpreadOdds ?? -110;

    const coverQueries = [
      { id: "home-ml", kind: "ml" as const, teamSide: "home" as const },
      { id: "away-ml", kind: "ml" as const, teamSide: "away" as const },
      {
        id: "home-sp",
        kind: "spread" as const,
        teamSide: "home" as const,
        line: prices.homeSpread,
      },
      {
        id: "away-sp",
        kind: "spread" as const,
        teamSide: "away" as const,
        line: prices.awaySpread,
      },
    ];

    const result = runNflDriveSim({
      sport: "ncaaf",
      simulations: SIMS,
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

    if (!result?.coverHitRates) {
      skippedNoQualify += 1;
      updateForm();
      continue;
    }

    const conf = result.confidenceScore ?? 0;
    const cands: Cand[] = [];
    const tryAdd = (
      id: string,
      market: "ml" | "spread",
      side: "home" | "away",
      odds: number,
      line?: number,
    ) => {
      const hit = result.coverHitRates?.[id];
      if (hit == null) return;
      const q = qualify(hit, odds, conf);
      if (!q) return;
      cands.push({ ...q, id, market, side, line, odds });
    };
    tryAdd("home-ml", "ml", "home", prices.homeMl);
    tryAdd("away-ml", "ml", "away", prices.awayMl);
    tryAdd("home-sp", "spread", "home", homeSpOdds, prices.homeSpread);
    tryAdd("away-sp", "spread", "away", awaySpOdds, prices.awaySpread);

    if (!cands.length) {
      skippedNoQualify += 1;
      updateForm();
      continue;
    }

    // Prefer sim-favored team when lean ≥ 3pp (gameSideConsistency / optimizer)
    const lean =
      Math.abs(result.homeWinProbability - result.awayWinProbability) >= 0.03
        ? result.homeWinProbability >= result.awayWinProbability
          ? "home"
          : "away"
        : null;
    const pool = lean ? cands.filter((c) => c.side === lean) : cands;
    const rankPool = pool.length ? pool : cands;
    rankPool.sort(
      (a, b) => b.edgePct - a.edgePct || b.simHit - a.simHit || b.evPct - a.evPct,
    );
    const best = rankPool[0]!;

    // Close odds for selected side
    let closeOdds: number | null = null;
    let spreadClv: number | null = null;
    if (best.market === "ml") {
      if (best.side === "home") closeOdds = Number(close.closeMlHome);
      else {
        // invert home ML to away close approx via vig-free complement of implied
        const pHome = mlToProb(Number(close.closeMlHome));
        const pAway = 1 - pHome;
        // convert pAway to american (no-vig approximation)
        closeOdds =
          pAway >= 0.5 ? Math.round(-100 * pAway / (1 - pAway)) : Math.round(100 * (1 - pAway) / pAway);
      }
    } else {
      // spread: close home spread; away close = -home
      const closeH = Number(close.closeSpreadHome);
      const closeLine = best.side === "home" ? closeH : -closeH;
      spreadClv =
        best.line != null ? Number(best.line) - closeLine : null;
      // use selection spread juice vs -110 close assumption for ML-style CLV on juice only when needed
      closeOdds = -110;
    }

    const clv =
      best.market === "ml" && closeOdds != null
        ? mlClv(best.odds, closeOdds)
        : null;

    let won: boolean | null = null;
    let covered: boolean | null = null;
    if (best.market === "ml") {
      if (g.homeFg !== g.awayFg) {
        won =
          best.side === "home" ? g.homeFg > g.awayFg : g.awayFg > g.homeFg;
      }
    } else if (best.line != null) {
      const margin =
        best.side === "home" ? g.homeFg - g.awayFg : g.awayFg - g.homeFg;
      const adj = margin + best.line;
      if (Math.abs(adj) > 1e-9) covered = adj > 0;
    }

    picks.push({
      gameId: g.eventId,
      week: g.week,
      kickoffIso: String(g.kickoffIso),
      selectionTimestamp: early.snap,
      market: best.market,
      side: best.side,
      line: best.line ?? null,
      selectionOdds: best.odds,
      closeOdds,
      simHit: best.simHit,
      edgePct: best.edgePct,
      evPct: best.evPct,
      clvProbPoints: clv,
      spreadClvPoints: spreadClv,
      won,
      covered,
      candidatesQualified: cands.length,
    });

    updateForm();
  }

  const mlPicks = picks.filter((p) => p.market === "ml" && p.clvProbPoints != null);
  const spPicks = picks.filter((p) => p.market === "spread");
  const decided = picks.filter((p) => p.won != null || p.covered != null);
  const wins = picks.filter((p) => p.won === true || p.covered === true).length;
  const losses = picks.filter((p) => p.won === false || p.covered === false).length;
  const clvs = mlPicks.map((p) => p.clvProbPoints!) ;
  const meanClv = clvs.length ? mean(clvs) : null;
  const meanAbsClv = clvs.length ? mean(clvs.map(Math.abs)) : null;
  const pctBeatClose = clvs.length
    ? clvs.filter((c) => c > 0).length / clvs.length
    : null;
  const hitRate = wins + losses > 0 ? wins / (wins + losses) : null;

  // Wilson interval for hit rate
  function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } | null {
    if (n <= 0) return null;
    const p = k / n;
    const d = 1 + (z * z) / n;
    const center = p + (z * z) / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return { lo: (center - margin) / d, hi: (center + margin) / d };
  }
  const wi = wilson(wins, wins + losses);

  const mktBrier =
    baseP.length > 0
      ? baseP.reduce((s, p, i) => s + (p - baseY[i]!) ** 2, 0) / baseP.length
      : null;

  // Side mix — prove not blanket home
  const homeSel = picks.filter((p) => p.side === "home").length;
  const awaySel = picks.filter((p) => p.side === "away").length;

  const report = {
    generatedAt: new Date().toISOString(),
    simulationsPerGame: SIMS,
    selectionCutoff: CUTOFF,
    competitionScope:
      "Odds-listed FBS games in ncaaf-phase-e-closing-lines.json (matchable americanfootball_ncaaf names). FCS/unlisted excluded.",
    selectionRules: {
      engine: "nfl-drive",
      form: "venue_split+L10 blend; chrono pre-kickoff only",
      prices: "Odds historical ~24h pre-kickoff (selection-time)",
      candidates: "home/away ML + home/away spread at selection lines",
      gates: [
        `simHit >= ${GAME_SIM_MIN_HIT}`,
        `confidenceScore >= ${COACH_SIM_MIN_CONFIDENCE}`,
        "edgePct > 0 (simHit > implied)",
        "evPct > 0",
      ],
      sideChoice:
        "Among qualifiers, prefer sim-favored side when |homeWinP-awayWinP|>=0.03; rank by edgePct then simHit. NOT blanket home.",
      note:
        "Offline eval applies Coach SIMULATION numeric gates. Full Final-AI rubric grades are not reconstructed; product NCAAF P0 remains armed.",
    },
    funnel: {
      selectionUniverseInScope: selectionUniverse,
      skippedNoClose: skippedNoClose,
      skippedNoEarlyPrices: skippedNoEarly,
      skippedThinForm: skippedThinForm,
      skippedNoQualify: skippedNoQualify,
      selectedPicks: picks.length,
      homeSelections: homeSel,
      awaySelections: awaySel,
      mlSelections: mlPicks.length,
      spreadSelections: spPicks.length,
    },
    coachPickClv: {
      nMlWithClv: mlPicks.length,
      meanClvProbPoints: meanClv,
      meanAbsClvProbPoints: meanAbsClv,
      pctSelectionsBeatClose: pctBeatClose,
      unit: "probability_points_0_to_1 for ML CLV; spread points for spreadClv",
      meanSpreadClvPoints: spPicks.length
        ? mean(spPicks.map((p) => p.spreadClvPoints!).filter((x) => x != null) as number[])
        : null,
    },
    outcomes: {
      decided: wins + losses,
      wins,
      losses,
      hitRate,
      wilson95: wi,
    },
    untouchedPeriodMarketBaseline: {
      cutoff: CUTOFF,
      nGames: baseP.length,
      marketBrierCloseMl: mktBrier,
      coinBrier: 0.25,
      marketBeatsCoin: mktBrier != null ? mktBrier < 0.25 : null,
      note: "No Coach selections on this period — close-ML Brier only.",
    },
    injuryKnown: null,
    verdicts: {
      E2b_coachPickClv: "COMPUTED_NO_PASS_LABEL",
      E2b_closeArchiveSoftGates: "see calibration report — not CLV",
      E4_injuryConservatism: "INSUFFICIENT_DATA",
      E6_humanSignOff: "OPEN",
      NCAAF_GAME_LINE_SIM_VALIDATED: "false — do not flip",
    },
    keepP0Armed: true,
    flagFlipAllowed: false,
  };

  mkdirSync(FIX, { recursive: true });
  writeFileSync(
    join(FIX, "ncaaf-phase-e-coach-pick-clv-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(
    join(FIX, "ncaaf-phase-e-coach-pick-clv-picks.json"),
    `${JSON.stringify({ picks }, null, 2)}\n`,
  );
  try {
    mkdirSync(ART, { recursive: true });
    writeFileSync(
      join(ART, "ncaaf-phase-e-coach-pick-clv-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch {
    /* optional */
  }

  console.log(JSON.stringify(report, null, 2));
  console.log("Wrote ncaaf-phase-e-coach-pick-clv-report.json");
  console.log("No CLV PASS label issued. Flag remains false.");
  return 2;
}

process.exit(main());
