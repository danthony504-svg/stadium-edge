import type { EspnGame, OddsGame } from "./api";

export type EspnOddsSnapshot = {
  provider?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  moneyline?: { home: number; away: number } | null;
  spread?: { homeLine: number; awayLine: number; homePrice: number; awayPrice: number } | null;
  total?: { line: number; over: number; under: number } | null;
};

const nick = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

/** Stable away|home nickname key for cross-feed game matching. */
export function gameNickKey(away: string, home: string): string {
  return `${nick(away)}|${nick(home)}`.toLowerCase();
}

export function findOddsByTeams(
  odds: OddsGame[],
  away: string,
  home: string,
): OddsGame | undefined {
  const key = gameNickKey(away, home);
  return odds.find((g) => gameNickKey(g.awayTeam, g.homeTeam) === key);
}

/** Build an OddsGame from ESPN pickcenter lines (live-game fallback). */
export function oddsGameFromEspnOdds(
  sport: string,
  espn: EspnGame,
  snap: EspnOddsSnapshot,
): OddsGame | null {
  const home = snap.homeTeam ?? espn.homeTeam ?? "";
  const away = snap.awayTeam ?? espn.awayTeam ?? "";
  if (!home || !away) return null;

  const markets: OddsGame["markets"] = [];
  const ml = snap.moneyline;
  if (ml) {
    markets.push({
      key: "h2h",
      outcomes: [
        { name: home, price: Math.round(ml.home), point: null },
        { name: away, price: Math.round(ml.away), point: null },
      ],
    });
  }
  const sp = snap.spread;
  if (sp) {
    markets.push({
      key: "spreads",
      outcomes: [
        { name: home, price: Math.round(sp.homePrice), point: sp.homeLine },
        { name: away, price: Math.round(sp.awayPrice), point: sp.awayLine },
      ],
    });
  }
  const tot = snap.total;
  if (tot) {
    markets.push({
      key: "totals",
      outcomes: [
        { name: "Over", price: Math.round(tot.over), point: tot.line },
        { name: "Under", price: Math.round(tot.under), point: tot.line },
      ],
    });
  }
  if (markets.length === 0) return null;

  return {
    id: espn.id,
    sport,
    homeTeam: home,
    awayTeam: away,
    commenceTime: espn.startsAt,
    markets,
  };
}

/** Minimal OddsGame shell so a live ESPN game can render without posted lines. */
export function oddsGameFromEspnShell(sport: string, espn: EspnGame): OddsGame | null {
  const home = espn.homeTeam ?? espn.homeAbbr ?? "";
  const away = espn.awayTeam ?? espn.awayAbbr ?? "";
  if (!home || !away) return null;
  return {
    id: espn.id,
    sport,
    homeTeam: home,
    awayTeam: away,
    commenceTime: espn.startsAt,
    markets: [],
  };
}
