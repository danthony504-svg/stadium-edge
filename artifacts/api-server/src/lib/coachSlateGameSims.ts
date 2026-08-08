import { pooled, slateLoopbackGet, slateLoopbackPost } from "./coachSlateLoopback.js";
import type { CoachGameSimEntry, RealOddsEntry } from "./coachSlateTypes.js";

type EspnGame = {
  id: string;
  sport: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  startsAt: string;
  state?: string | null;
  status?: string;
};

type GameOutcomeResponse = {
  homeWinProbability?: number;
  awayWinProbability?: number;
  coverHitRates?: Record<string, number>;
};

function parseGameLabel(game: string): { away: string; home: string } | null {
  const parts = game.split(" @ ");
  if (parts.length !== 2) return null;
  return { away: parts[0]!.trim(), home: parts[1]!.trim() };
}

function americanImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function teamSideForPick(
  pick: string,
  away: string,
  home: string,
): "home" | "away" | null {
  const p = pick.toLowerCase();
  const a = away.toLowerCase();
  const h = home.toLowerCase();
  const aNick = a.split(/\s+/).pop() ?? a;
  const hNick = h.split(/\s+/).pop() ?? h;
  if (p.includes(a) || p.includes(aNick)) return "away";
  if (p.includes(h) || p.includes(hNick)) return "home";
  return null;
}

function coverQueryForLine(o: RealOddsEntry): { id: string; kind: string; teamSide?: string; line?: number; totalSide?: string } | null {
  const label = parseGameLabel(o.game);
  if (!label) return null;
  const m = o.market.toLowerCase();
  const p = o.pick.toLowerCase();

  if (m.includes("moneyline") || m === "h2h") {
    const side = teamSideForPick(o.pick, label.away, label.home);
    if (!side) return null;
    return { id: `${o.game}|ml|${side}`, kind: "ml", teamSide: side };
  }
  if (m.includes("spread") || m.includes("run line") || m.includes("puck line")) {
    const side = teamSideForPick(o.pick, label.away, label.home);
    const match = o.pick.match(/([+-]?\d+(?:\.\d+)?)/);
    if (!side || !match) return null;
    return { id: `${o.game}|spread|${side}|${match[1]}`, kind: "spread", teamSide: side, line: parseFloat(match[1]!) };
  }
  if (m.includes("total")) {
    const totalSide = p.includes("under") ? "under" : p.includes("over") ? "over" : null;
    const match = o.pick.match(/(\d+(?:\.\d+)?)/);
    if (!totalSide || !match) return null;
    return { id: `${o.game}|total|${totalSide}|${match[1]}`, kind: "total", totalSide, line: parseFloat(match[1]!) };
  }
  return null;
}

/** 10k game-outcome sim per matchup — powers AI-ranked game-line legs on the server slate. */
export async function fetchServerGameSimulations(
  realOdds: RealOddsEntry[],
): Promise<Map<string, CoachGameSimEntry>> {
  const out = new Map<string, CoachGameSimEntry>();
  const byGame = new Map<string, RealOddsEntry[]>();
  for (const o of realOdds) {
    const rows = byGame.get(o.game) ?? [];
    rows.push(o);
    byGame.set(o.game, rows);
  }

  const entries = [...byGame.entries()].slice(0, 28);
  await pooled(entries, 3, async ([game, lines]) => {
    const label = parseGameLabel(game);
    if (!label) return;
    const sport = lines[0]?.sport;
    if (!sport) return;

    const games = await slateLoopbackGet<EspnGame[]>(`/sports/games?sport=${sport}`);
    const espn = (games ?? []).find(
      (g) =>
        (g.homeTeam === label.home && g.awayTeam === label.away) ||
        (`${g.awayTeam} @ ${g.homeTeam}` === game),
    );
    if (!espn) return;

    const coverQueries: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const line of lines.slice(0, 24)) {
      const q = coverQueryForLine(line);
      if (!q || seen.has(q.id)) continue;
      seen.add(q.id);
      coverQueries.push(q);
    }
    if (!coverQueries.length) {
      coverQueries.push({ id: `${game}|ml|home`, kind: "ml", teamSide: "home" });
      coverQueries.push({ id: `${game}|ml|away`, kind: "ml", teamSide: "away" });
    }

    const nameOnly = ["tennis", "ufc", "mma"].includes(sport);
    const body: Record<string, unknown> = {
      sport,
      homeTeam: espn.homeTeam ?? label.home,
      awayTeam: espn.awayTeam ?? label.away,
      simulations: 10_000,
      coverQueries,
      retainOutcomes: false,
    };
    if (!nameOnly) {
      if (!espn.homeTeamId || !espn.awayTeamId) return;
      body.homeTeamId = espn.homeTeamId;
      body.awayTeamId = espn.awayTeamId;
    }

    const resp = await slateLoopbackPost<GameOutcomeResponse>(
      "/sports/simulate/game-outcome",
      body,
      120_000,
    );
    if (!resp) return;
    out.set(game, {
      winProbHome: resp.homeWinProbability ?? null,
      winProbAway: resp.awayWinProbability ?? null,
      coverProbs: resp.coverHitRates ?? {},
    });
  });

  return out;
}

export function simHitForGameLine(
  o: RealOddsEntry,
  sim: CoachGameSimEntry | undefined,
): number | null {
  if (!sim?.coverProbs) return null;
  const q = coverQueryForLine(o);
  if (q && sim.coverProbs[q.id] != null) return sim.coverProbs[q.id]!;
  const label = parseGameLabel(o.game);
  if (!label) return null;
  const side = teamSideForPick(o.pick, label.away, label.home);
  if (side === "home" && sim.winProbHome != null) return sim.winProbHome;
  if (side === "away" && sim.winProbAway != null) return sim.winProbAway;
  return null;
}

export function qualifiesServerAiLine(o: RealOddsEntry, simHit: number | null): boolean {
  if (!Number.isFinite(o.odds) || o.odds === 0) return false;
  if (simHit == null || !Number.isFinite(simHit)) return false;
  const implied = americanImplied(o.odds);
  return simHit > implied && simHit >= 0.52;
}
