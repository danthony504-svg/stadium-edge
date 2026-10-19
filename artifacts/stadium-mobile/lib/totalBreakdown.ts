import { parseMarketPeriod } from "./simMarketSupport";

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const matches = (a: string, b: string) => {
  const aa = norm(a).split(" ").filter(Boolean);
  const bb = norm(b).split(" ").filter(Boolean);
  if (!aa.length || !bb.length) return false;
  const [short, long] = aa.length < bb.length ? [aa, bb] : [bb, aa];
  return short.every(w => long.includes(w));
};

/** Never substitute the first same-sport search result for an unresolved team. */
export function resolveBreakdownTeam<T extends { name: string; sport?: string }>(rows: T[], name: string, sport: string): T | null {
  const candidates = rows.filter(t => t.sport === sport);
  const exact = candidates.filter(t => norm(t.name) === norm(name));
  const hits = exact.length ? exact : candidates.filter(t => matches(t.name, name));
  return hits.length === 1 ? hits[0] : null;
}

export function totalSelection(pick: string) {
  const m = pick.match(/\b(Over|Under)\s+([0-9]+(?:\.[0-9]+)?)\b/i);
  return m ? { side: /^over$/i.test(m[1]) ? "Over" as const : "Under" as const, line: Number(m[2]) } : null;
}

/** Read both current links and older Coach links carrying team/opp instead of away/home. */
export function totalBreakdown(params: { away?: string; home?: string; team?: string; opp?: string; game?: string; market?: string; pick?: string; line?: string }) {
  const pair = String(params.game ?? "").split(/\s+@\s+/);
  const away = (params.away || (pair.length === 2 ? pair[0] : "") || params.team || "").trim();
  const home = (params.home || (pair.length === 2 ? pair[1] : "") || params.opp || "").trim();
  const market = String(params.market ?? "Total");
  const teamTotal = /\bteam\s*totals?\b/i.test(market.replace(/[_-]/g, " "));
  const selection = totalSelection(params.pick ?? "");
  const supplied = params.line?.trim() ? Number(params.line) : null;
  const line = selection?.line ?? (supplied != null && Number.isFinite(supplied) ? supplied : null);
  const named = (params.pick ?? "").split(/\b(?:Over|Under)\b/i)[0].trim();
  const pickedAway = matches(named, away);
  const pickedHome = matches(named, home);
  const selectedTeam = teamTotal && pickedAway !== pickedHome ? (pickedAway ? away : home) : null;
  const periodSupported = parseMarketPeriod(market) === "fg";
  // Schedule final scores do not measure period totals, sets, corners or other specialties.
  const scoreMarket = norm(market).split(" ").every(w => ["game", "match", "team", "total", "totals", "alt", "alternate", "points", "runs", "goals"].includes(w));
  const scoreHistorySupported = periodSupported && scoreMarket;
  return { away, home, teamTotal, selectedTeam, line, side: selection?.side ?? null, scoreHistorySupported };
}

export function totalHistoryRows<T extends { pts: number | null; oppPts: number | null }>(recent: T[], teamTotal: boolean) {
  return recent.filter(g => typeof g.pts === "number" && Number.isFinite(g.pts) && (teamTotal || (typeof g.oppPts === "number" && Number.isFinite(g.oppPts))))
    .slice(0, 10).map(g => ({ ...g, total: teamTotal ? g.pts! : g.pts! + g.oppPts! }));
}

export function totalHistoryCounts(games: { total: number }[], line: number | null, side: "Over" | "Under" | null) {
  if (line == null || !side) return { hits: 0, pushes: 0 };
  return {
    hits: games.filter(g => side === "Over" ? g.total > line : g.total < line).length,
    pushes: games.filter(g => g.total === line).length,
  };
}
