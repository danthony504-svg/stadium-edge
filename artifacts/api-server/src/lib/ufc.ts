import { cachedJson } from "./sports.js";

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
  // career rates (ESPN "General" statistics split). null when ESPN doesn't
  // carry the value OR reports a placeholder 0 for a percentage/accuracy stat.
  strikeAccuracy: number | null; // % of significant strikes that land
  strikeLPM: number | null; // significant strikes landed per minute
  takedownAccuracy: number | null; // % of takedown attempts that land
  takedownAvg: number | null; // takedowns landed per 15 min
  submissionAvg: number | null; // submission attempts per 15 min
  finishPct: number | null; // KO/TKO % + (decision is the remainder)
  decisionPct: number | null; // % of wins by decision
};

export type Fighter = {
  name: string; // the name we resolved against (echo of the query)
  resolvedName: string | null; // ESPN's canonical display name (null if unresolved)
  athleteId: string | null;
  weightClass: string | null;
  record: { wins: number; losses: number; draws: number; winPct: number } | null;
  stats: FighterStats;
};

export type FightLean = {
  side: string; // resolvedName of the favored fighter
  edge: number; // strength of the lean (>= 1 = a confident read)
  reasons: string[]; // real cited numbers behind the lean
};

export type FightAnalysis = {
  away: Fighter;
  home: Fighter;
  lean: FightLean | null;
};

const SEARCH_TTL = 24 * 60 * 60 * 1000; // fighter ids are stable — cache a day
const PROFILE_TTL = 6 * 60 * 60 * 1000; // records/stats move slowly between cards
const ANALYSIS_TTL = 30 * 60 * 1000;

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN ${r.status} ${url}`);
  return r.json();
}

// Diacritic-/punctuation-insensitive fighter-name key for matching ESPN display
// names against the odds-feed names (e.g. "Joanderson Brito" vs "Joandérson
// Brito", "Cory Sandhagen" vs "Cory  Sandhagen"). Lowercased, accents stripped,
// non-alphanumerics collapsed to single spaces.
export function normFighter(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Resolve a fighter name -> ESPN numeric athlete id via the public search API.
// The search "player" result carries a GUID id, but the REAL numeric athlete id
// lives in the web link (".../fighter/_/id/2335639/jon-jones") — parse it out.
// We only accept results whose sport is mma so a same-name athlete in another
// sport can never leak in. Returns null when no mma fighter matches.
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
    // Fail-closed resolution so a wrong fighter's REAL stats are never attached
    // to a bout (misattributed real data still violates the never-fabricate rule).
    // Require a diacritic-/punctuation-insensitive exact display-name match; only
    // fall back to a lone hit when the mma search returned exactly ONE candidate
    // (unambiguous). Anything else returns null and the card shows "unavailable".
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

// A percentage/accuracy stat reported as exactly 0 is almost always an
// unpopulated placeholder for an active fighter, so treat it as missing rather
// than fabricating a "0% accuracy" comparison. Per-fight averages (LPM, TD avg,
// sub avg) CAN legitimately be 0, so those are kept as-is.
function pctOrNull(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 10) / 10;
}
function avgOrNull(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100) / 100;
}

export async function getFighterProfile(name: string): Promise<Fighter> {
  const empty: Fighter = {
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
  };
  const id = await resolveFighterId(name);
  if (!id) return empty;
  return cachedJson<Fighter>(`ufc:profile:${id}`, PROFILE_TTL, async () => {
    const base = `https://sports.core.api.espn.com/v2/sports/mma/athletes/${id}`;
    const [core, records, statistics] = await Promise.allSettled([
      fetchJson(`${base}?lang=en&region=us`),
      fetchJson(`${base}/records?lang=en&region=us`),
      fetchJson(`${base}/statistics?lang=en&region=us`),
    ]);
    const out: Fighter = { ...empty, athleteId: id };
    if (core.status === "fulfilled") {
      const d = core.value;
      out.resolvedName = d?.displayName || d?.fullName || null;
      const wc = d?.weightClass;
      out.weightClass = (typeof wc === "object" ? wc?.text : wc) || null;
    }
    if (records.status === "fulfilled") {
      const items = records.value?.items || [];
      const overall = items.find((x: any) => x?.type === "total") || items[0];
      out.record = parseRecord(overall?.summary || overall?.displayValue, overall?.value);
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
    return out;
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Deterministic "stronger fighter" lean from REAL numbers only. Each factor
// contributes a signed amount toward whichever fighter has the better real
// value; a factor is skipped entirely unless BOTH fighters have real data for
// it (so a missing/placeholder stat never invents an edge). Positive total
// favors `away`, negative favors `home`. reasons[] cite the real figures.
export function computeFightLean(away: Fighter, home: Fighter): FightLean | null {
  let signed = 0; // + favors away, - favors home
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
    if (Math.abs(contrib) < 0.15) return; // ignore negligible diffs
    used++;
    signed += contrib;
    if (contrib > 0) awayReasons.push(label(away.resolvedName || away.name, a, h));
    else homeReasons.push(label(home.resolvedName || home.name, h, a));
  };

  // Record win% — the most reliable signal (weight tuned so a 20-pt gap ~= 1.0).
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
  factor(away.stats.strikeAccuracy, home.stats.strikeAccuracy, 0.06, 1.2, (fav, f, d) =>
    `${fav} lands ${f}% of significant strikes vs ${d}%`,
  );
  factor(away.stats.strikeLPM, home.stats.strikeLPM, 0.5, 1.0, (fav, f, d) =>
    `${fav} higher striking output (${f} sig strikes/min vs ${d})`,
  );
  factor(away.stats.finishPct, home.stats.finishPct, 0.04, 1.2, (fav, f, d) =>
    `${fav} finishes more often (${f}% KO/TKO vs ${d}%)`,
  );
  factor(away.stats.takedownAvg, home.stats.takedownAvg, 0.35, 1.0, (fav, f, d) =>
    `${fav} stronger grappling (${f} takedowns/15min vs ${d})`,
  );
  factor(away.stats.takedownAccuracy, home.stats.takedownAccuracy, 0.04, 0.8, (fav, f, d) =>
    `${fav} better takedown accuracy (${f}% vs ${d}%)`,
  );

  if (used === 0) return null;
  const edge = Math.round(Math.abs(signed) * 10) / 10;
  if (edge < 0.3) return null; // genuinely too close to call
  const awayFav = signed > 0;
  const side = awayFav ? away.resolvedName || away.name : home.resolvedName || home.name;
  const reasons = awayFav ? awayReasons : homeReasons;
  return { side, edge, reasons };
}

export async function buildFightAnalysis(away: string, home: string): Promise<FightAnalysis> {
  const key = `ufc:fight:${String(away).toLowerCase()}|${String(home).toLowerCase()}`;
  return cachedJson<FightAnalysis>(key, ANALYSIS_TTL, async () => {
    const [a, h] = await Promise.all([getFighterProfile(away), getFighterProfile(home)]);
    return { away: a, home: h, lean: computeFightLean(a, h) };
  });
}
