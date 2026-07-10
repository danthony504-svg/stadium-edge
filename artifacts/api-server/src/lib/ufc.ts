import { cachedJson } from "./sports.js";
import type { FightSimResult } from "./ufcMonteCarlo.js";
import type {
  FightBookLine,
  FightRecommendation,
  H2hPostedOutcome,
} from "./fightRecommendations.js";
import {
  buildFightPickAnalysis,
  simMetricsFromResult,
  type FightPickAnalysis,
  type FightSimMetrics,
} from "./fightPickAnalysis.js";

// ---------------------------------------------------------------------------
// UFC / MMA fighter data from ESPN's public core API. The app's UFC tab only
// has moneyline (h2h) odds — there are NO player props, spreads, or totals for
// combat sports. This module adds the ONE real analytics layer we can build for
// fights: each fighter's real W-L-D record + career striking/grappling rates,
// and a deterministic "who's the stronger fighter and why" lean computed from
// those real numbers. HARD never-fabricate: every value here is parsed straight
// from ESPN; anything missing is returned as null (callers must honest-null it),
// never guessed.
// ---------------------------------------------------------------------------

export type FighterStats = {
  strikeAccuracy: number | null;
  strikeLPM: number | null;
  takedownAccuracy: number | null;
  takedownAvg: number | null;
  submissionAvg: number | null;
  finishPct: number | null;
  decisionPct: number | null;
};

export type FighterMethods = {
  koWins: number | null;
  tkoWins: number | null;
  subWins: number | null;
  decisionWins: number | null;
  koLosses: number | null;
  tkoLosses: number | null;
  subLosses: number | null;
};

export type FighterProfile = {
  age: number | null;
  heightIn: number | null;
  displayHeight: string | null;
  reachIn: number | null;
  displayReach: string | null;
  stance: string | null;
  citizenship: string | null;
};

export type FighterStyle = "striker" | "grappler" | "wrestler" | "mixed" | null;

export type FighterDataSource = "espn" | "sherdog" | "tapology";

export type FighterRecentFight = {
  result: "W" | "L" | "D" | null;
  opponent: string | null;
  date: string | null;
  method: string | null;
};

export type Fighter = {
  name: string;
  resolvedName: string | null;
  athleteId: string | null;
  weightClass: string | null;
  record: { wins: number; losses: number; draws: number; winPct: number } | null;
  stats: FighterStats;
  profile: FighterProfile;
  methods: FighterMethods;
  style: FighterStyle;
  dataSources: FighterDataSource[];
  recentForm: FighterRecentFight[];
};

export type FightLean = {
  side: string;
  edge: number;
  reasons: string[];
};

export type FightComparison = {
  reachAdvantageIn: number | null;
  reachAdvantageFighter: string | null;
  styleMatchup: string | null;
  /** Stats requested by product but not available from ESPN for either fighter. */
  unavailable: string[];
};

export type FightAnalysis = {
  away: Fighter;
  home: Fighter;
  lean: FightLean | null;
  comparison: FightComparison;
  simulation: FightSimResult;
  prePickAnalysis: FightPickAnalysis;
  simMetrics: FightSimMetrics;
  recommendations: FightRecommendation[];
  books: FightBookLine[];
};

const SEARCH_TTL = 24 * 60 * 60 * 1000;
const PROFILE_TTL = 6 * 60 * 60 * 1000;
const ANALYSIS_TTL = 30 * 60 * 1000;

const UNAVAILABLE_STATS = [
  "Significant strike defense",
  "Knockdown average",
  "Takedown defense",
  "Recent form (last 5 fights)",
  "Win/loss streak",
  "Strength of opponents",
  "UFC experience (bout count)",
  "Days since last fight",
  "Weight misses",
  "Injuries",
  "Travel distance / altitude",
  "Round count (main vs prelim)",
  "Cardio / chin / ground control",
  "Betting line movement",
  "Public / sharp betting %",
  "Round props & method props",
] as const;

const emptyMethods = (): FighterMethods => ({
  koWins: null,
  tkoWins: null,
  subWins: null,
  decisionWins: null,
  koLosses: null,
  tkoLosses: null,
  subLosses: null,
});

const emptyProfile = (): FighterProfile => ({
  age: null,
  heightIn: null,
  displayHeight: null,
  reachIn: null,
  displayReach: null,
  stance: null,
  citizenship: null,
});

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN ${r.status} ${url}`);
  return r.json();
}

export function normFighter(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function resolveFighterId(name: string): Promise<string | null> {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const key = `ufc:id:${clean.toLowerCase()}`;
  return cachedJson<string | null>(key, SEARCH_TTL, async () => {
    const url = `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(clean)}&limit=8`;
    let data: any;
    try {
      data = await fetchJson(url);
    } catch {
      return null;
    }
    const players: any[] = [];
    for (const r of data?.results || []) {
      if (r?.type === "player") for (const c of r.contents || []) players.push(c);
    }
    const mma = players.filter((c) => String(c?.sport || "").toLowerCase() === "mma");
    if (mma.length === 0) return null;
    const idFrom = (c: any): string | null => {
      const web = c?.link?.web || "";
      const m = /\/id\/(\d+)\//.exec(String(web));
      return m ? m[1] : null;
    };
    const target = normFighter(clean);
    const exact = mma.find((c) => normFighter(c?.displayName) === target);
    if (exact) return idFrom(exact);
    if (mma.length === 1) return idFrom(mma[0]);
    return null;
  });
}

function parseRecord(summary: string | undefined, winPctValue: unknown): Fighter["record"] {
  if (!summary) return null;
  const m = /(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/.exec(summary);
  if (!m) return null;
  const wins = parseInt(m[1], 10);
  const losses = parseInt(m[2], 10);
  const draws = parseInt(m[3], 10);
  let winPct: number;
  if (typeof winPctValue === "number" && Number.isFinite(winPctValue)) {
    winPct = winPctValue <= 1 ? winPctValue * 100 : winPctValue;
  } else {
    const decided = wins + losses;
    winPct = decided > 0 ? (wins / decided) * 100 : 0;
  }
  return { wins, losses, draws, winPct: Math.round(winPct * 10) / 10 };
}

function pctOrNull(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 10) / 10;
}

function avgOrNull(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100) / 100;
}

function intOrNull(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function parseStance(raw: unknown): string | null {
  const text = typeof raw === "object" && raw ? (raw as { text?: string }).text : raw;
  const s = String(text ?? "").trim();
  if (!s || s === "--" || s === "-") return null;
  return s;
}

function statVal(stats: any[], name: string): number | null {
  const s = stats.find((x) => x?.name === name);
  return typeof s?.value === "number" && Number.isFinite(s.value) ? s.value : null;
}

function parseMethodStats(stats: any[], wins: number | null): FighterMethods {
  const ko = intOrNull(statVal(stats, "kos"));
  const tko = intOrNull(statVal(stats, "tkos"));
  const sub = intOrNull(statVal(stats, "submissions"));
  let decision: number | null = null;
  if (wins != null && ko != null && tko != null && sub != null) {
    const d = wins - ko - tko - sub;
    decision = d >= 0 ? d : null;
  }
  return {
    koWins: ko,
    tkoWins: tko,
    subWins: sub,
    decisionWins: decision,
    koLosses: null,
    tkoLosses: intOrNull(statVal(stats, "tkoLosses")),
    subLosses: intOrNull(statVal(stats, "submissionLosses")),
  };
}

export function classifyFighterStyle(f: Fighter): FighterStyle {
  let strike = 0;
  let wrestle = 0;
  let grapple = 0;
  if (f.stats.strikeLPM != null && f.stats.strikeLPM >= 4) strike += 1;
  if (f.stats.strikeAccuracy != null && f.stats.strikeAccuracy >= 52) strike += 0.5;
  if (f.stats.takedownAvg != null && f.stats.takedownAvg >= 1.5) wrestle += 1;
  if (f.stats.takedownAccuracy != null && f.stats.takedownAccuracy >= 38) wrestle += 0.5;
  if (f.stats.submissionAvg != null && f.stats.submissionAvg >= 0.35) grapple += 1;
  const w = f.record?.wins ?? 0;
  if (w > 0) {
    const subs = f.methods.subWins ?? 0;
    const finishes = (f.methods.koWins ?? 0) + (f.methods.tkoWins ?? 0) + subs;
    if (subs / w >= 0.25) grapple += 1;
    if (finishes / w >= 0.55) strike += 0.5;
  }
  const top = Math.max(strike, wrestle, grapple);
  if (top < 0.75) return null;
  if (strike >= wrestle && strike >= grapple && strike >= 1 && wrestle < 0.75) return "striker";
  if (wrestle >= grapple && wrestle >= 1 && strike < 0.75) return "wrestler";
  if (grapple >= 1 && strike < 0.75 && wrestle < 0.75) return "grappler";
  return "mixed";
}

const styleLabel = (s: FighterStyle): string => {
  if (s === "striker") return "Striker";
  if (s === "wrestler") return "Wrestler";
  if (s === "grappler") return "Grappler";
  if (s === "mixed") return "Mixed";
  return "Unknown";
};

function unavailableComparisonStats(away: Fighter, home: Fighter): string[] {
  const hasRecentForm = away.recentForm.length > 0 || home.recentForm.length > 0;
  return UNAVAILABLE_STATS.filter((s) => {
    if (s === "Recent form (last 5 fights)" && hasRecentForm) return false;
    return true;
  });
}

export function buildFightComparison(away: Fighter, home: Fighter): FightComparison {
  const reachAdvantageIn =
    away.profile.reachIn != null && home.profile.reachIn != null
      ? Math.round((away.profile.reachIn - home.profile.reachIn) * 10) / 10
      : null;
  let reachAdvantageFighter: string | null = null;
  if (reachAdvantageIn != null && Math.abs(reachAdvantageIn) >= 0.5) {
    reachAdvantageFighter =
      reachAdvantageIn > 0
        ? away.resolvedName || away.name
        : home.resolvedName || home.name;
  }
  let styleMatchup: string | null = null;
  if (away.style && home.style) {
    styleMatchup = `${styleLabel(away.style)} vs ${styleLabel(home.style)}`;
  }
  return {
    reachAdvantageIn,
    reachAdvantageFighter,
    styleMatchup,
    unavailable: unavailableComparisonStats(away, home),
  };
}

function emptyFighter(name: string): Fighter {
  return {
    name,
    resolvedName: null,
    athleteId: null,
    weightClass: null,
    record: null,
    stats: {
      strikeAccuracy: null,
      strikeLPM: null,
      takedownAccuracy: null,
      takedownAvg: null,
      submissionAvg: null,
      finishPct: null,
      decisionPct: null,
    },
    profile: emptyProfile(),
    methods: emptyMethods(),
    style: null,
    dataSources: [],
    recentForm: [],
  };
}

async function loadEspnFighterProfile(name: string, id: string): Promise<Fighter> {
  return cachedJson<Fighter>(`ufc:profile:v3:${id}`, PROFILE_TTL, async () => {
    const base = `https://sports.core.api.espn.com/v2/sports/mma/athletes/${id}`;
    const [core, records, statistics] = await Promise.allSettled([
      fetchJson(`${base}?lang=en&region=us`),
      fetchJson(`${base}/records?lang=en&region=us`),
      fetchJson(`${base}/statistics?lang=en&region=us`),
    ]);
    const out = emptyFighter(name);
    out.athleteId = id;
    out.dataSources = ["espn"];
    if (core.status === "fulfilled") {
      const d = core.value;
      out.resolvedName = d?.displayName || d?.fullName || null;
      const wc = d?.weightClass;
      out.weightClass = (typeof wc === "object" ? wc?.text : wc) || null;
      out.profile = {
        age: typeof d?.age === "number" && Number.isFinite(d.age) ? d.age : null,
        heightIn: typeof d?.height === "number" ? d.height : null,
        displayHeight: d?.displayHeight ?? null,
        reachIn: typeof d?.reach === "number" ? d.reach : null,
        displayReach:
          typeof d?.reach === "number" ? `${d.reach}"` : null,
        stance: parseStance(d?.stance),
        citizenship: d?.citizenship ?? d?.birthPlace?.country ?? null,
      };
    }
    if (records.status === "fulfilled") {
      const items = records.value?.items || [];
      const overall = items.find((x: any) => x?.type === "total") || items[0];
      out.record = parseRecord(overall?.summary || overall?.displayValue, overall?.value);
      const recStats = overall?.stats ?? [];
      out.methods = parseMethodStats(recStats, out.record?.wins ?? null);
    }
    if (statistics.status === "fulfilled") {
      const cats = statistics.value?.splits?.categories || [];
      const flat: Record<string, number> = {};
      for (const cat of cats) {
        for (const s of cat?.stats || []) {
          if (typeof s?.value === "number") flat[s.name] = s.value;
        }
      }
      const ko = pctOrNull(flat.koPercentage);
      const tko = pctOrNull(flat.tkoPercentage);
      out.stats = {
        strikeAccuracy: pctOrNull(flat.strikeAccuracy),
        strikeLPM: avgOrNull(flat.strikeLPM),
        takedownAccuracy: pctOrNull(flat.takedownAccuracy),
        takedownAvg: avgOrNull(flat.takedownAvg),
        submissionAvg: avgOrNull(flat.submissionAvg),
        finishPct: ko != null || tko != null ? Math.round(((ko || 0) + (tko || 0)) * 10) / 10 : null,
        decisionPct: pctOrNull(flat.decisionPercentage),
      };
    }
    out.style = classifyFighterStyle(out);
    return out;
  });
}

export async function getFighterProfile(
  name: string,
  opts: { opponent?: string } = {},
): Promise<Fighter> {
  const id = await resolveFighterId(name);
  let base: Fighter = id ? await loadEspnFighterProfile(name, id) : emptyFighter(name);
  if (base.athleteId && !base.dataSources.includes("espn")) {
    base.dataSources = ["espn"];
  }
  const { fighterNeedsSupplement, loadSupplementalFighterProfile, mergeFighters } = await import(
    "./mmaSupplement.js"
  );
  if (fighterNeedsSupplement(base)) {
    const supplemental = await loadSupplementalFighterProfile(name, opts);
    if (supplemental) {
      base = id ? mergeFighters(base, supplemental) : { ...supplemental, name };
      if (!base.style) base.style = classifyFighterStyle(base);
    }
  }
  return base;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function computeFightLean(away: Fighter, home: Fighter): FightLean | null {
  let signed = 0;
  let used = 0;
  const awayReasons: string[] = [];
  const homeReasons: string[] = [];

  const factor = (
    a: number | null,
    h: number | null,
    weight: number,
    cap: number,
    label: (favName: string, fav: number, dog: number) => string,
  ) => {
    if (a == null || h == null) return;
    const contrib = clamp((a - h) * weight, -cap, cap);
    if (Math.abs(contrib) < 0.15) return;
    used++;
    signed += contrib;
    if (contrib > 0) awayReasons.push(label(away.resolvedName || away.name, a, h));
    else homeReasons.push(label(home.resolvedName || home.name, h, a));
  };

  if (away.record && home.record) {
    factor(
      away.record.winPct,
      home.record.winPct,
      0.05,
      2.0,
      (fav, f, d) => {
        const r = fav === (away.resolvedName || away.name) ? away.record! : home.record!;
        const or = fav === (away.resolvedName || away.name) ? home.record! : away.record!;
        return `${fav} ${r.wins}-${r.losses}-${r.draws} (${r.winPct}% wins) vs ${or.wins}-${or.losses}-${or.draws} (${or.winPct}%)`;
      },
    );
  }

  if (away.profile.age != null && home.profile.age != null) {
    factor(home.profile.age, away.profile.age, 0.03, 0.6, (fav, f, d) =>
      `${fav} younger (${d} vs ${f} years)`,
    );
  }

  if (away.profile.reachIn != null && home.profile.reachIn != null) {
    factor(away.profile.reachIn, home.profile.reachIn, 0.04, 0.8, (fav, f, d) =>
      `${fav} longer reach (${f}" vs ${d}")`,
    );
  }

  factor(away.stats.strikeAccuracy, home.stats.strikeAccuracy, 0.06, 1.2, (fav, f, d) =>
    `${fav} lands ${f}% of significant strikes vs ${d}%`,
  );
  factor(away.stats.strikeLPM, home.stats.strikeLPM, 0.5, 1.0, (fav, f, d) =>
    `${fav} higher striking output (${f} sig strikes/min vs ${d})`,
  );
  factor(away.stats.finishPct, home.stats.finishPct, 0.04, 1.2, (fav, f, d) =>
    `${fav} finishes more often (${f}% KO/TKO vs ${d}%)`,
  );
  factor(away.stats.decisionPct, home.stats.decisionPct, -0.03, 0.8, (fav, f, d) =>
    `${fav} goes to decision less (${f}% vs ${d}%)`,
  );
  factor(away.stats.takedownAvg, home.stats.takedownAvg, 0.35, 1.0, (fav, f, d) =>
    `${fav} stronger grappling (${f} takedowns/15min vs ${d})`,
  );
  factor(away.stats.takedownAccuracy, home.stats.takedownAccuracy, 0.04, 0.8, (fav, f, d) =>
    `${fav} better takedown accuracy (${f}% vs ${d}%)`,
  );
  factor(away.stats.submissionAvg, home.stats.submissionAvg, 0.45, 0.8, (fav, f, d) =>
    `${fav} more submission threat (${f} att/15min vs ${d})`,
  );

  if (used === 0) return null;
  const edge = Math.round(Math.abs(signed) * 10) / 10;
  if (edge < 0.3) return null;
  const awayFav = signed > 0;
  const side = awayFav ? away.resolvedName || away.name : home.resolvedName || home.name;
  const reasons = awayFav ? awayReasons : homeReasons;
  return { side, edge, reasons };
}

export type BuildFightAnalysisOpts = {
  h2hOutcomes?: H2hPostedOutcome[];
  simulations?: number;
};

export async function buildFightAnalysis(
  away: string,
  home: string,
  opts: BuildFightAnalysisOpts = {},
): Promise<FightAnalysis> {
  const key = `ufc:fight:v4:${String(away).toLowerCase()}|${String(home).toLowerCase()}`;
  const base = await cachedJson<Omit<FightAnalysis, "recommendations" | "books" | "prePickAnalysis" | "simMetrics">>(
    key,
    ANALYSIS_TTL,
    async () => {
      const { runFightMonteCarlo } = await import("./ufcMonteCarlo.js");
      const [a, h] = await Promise.all([
        getFighterProfile(away, { opponent: home }),
        getFighterProfile(home, { opponent: away }),
      ]);
      const lean = computeFightLean(a, h);
      const comparison = buildFightComparison(a, h);
      const simulation = runFightMonteCarlo({ away: a, home: h, lean, comparison });
      return { away: a, home: h, lean, comparison, simulation };
    },
  );

  const outcomes = opts.h2hOutcomes ?? [];
  const prePickAnalysis = buildFightPickAnalysis(base.away, base.home, base.comparison, outcomes.length);
  const simMetrics = simMetricsFromResult(base.simulation);

  if (outcomes.length === 0) {
    return { ...base, prePickAnalysis, simMetrics, recommendations: [], books: [] };
  }
  const { buildFightRecommendations } = await import("./fightRecommendations.js");
  const { recommendations, books } = buildFightRecommendations(
    { ...base, prePickAnalysis, simMetrics, recommendations: [], books: [] },
    away,
    home,
    outcomes,
    base.simulation,
    prePickAnalysis,
  );
  return { ...base, prePickAnalysis, simMetrics, recommendations, books };
}

export type { FightSimResult, FightRecommendation, FightBookLine, H2hPostedOutcome, FightPickAnalysis, FightSimMetrics };
