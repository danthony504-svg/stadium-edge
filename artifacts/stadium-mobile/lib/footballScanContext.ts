/**
 * Parallel NFL/NCAAF weather + field context for Coach board scans.
 * One cached /weather/parks call per football sport — does not add sequential
 * delay when awaited alongside injuries.
 */

import {
  getParkWeather,
  type EspnGame,
  type ParkWeatherReport,
} from "./api.ts";
import { teamNameMatches } from "./injuries.ts";
import { lookupFootballCoach } from "./footballCoachTendencies.ts";

export type FootballGameEnvSlice = {
  park?: { dome?: boolean; surface?: "turf" | "grass" | null } | null;
  weather?: {
    tempF?: number | null;
    windMph?: number | null;
    condition?: string | null;
    precipChancePct?: number | null;
  } | null;
  climateControlled?: boolean;
  impactRating?: string | null;
  coaches?: {
    home?: { name: string; aggressive: number; favLean: number } | null;
    away?: { name: string; aggressive: number; favLean: number } | null;
  };
};

function gameKey(away: string, home: string): string {
  return `${away} @ ${home}`;
}

function matchReportToGame(
  report: ParkWeatherReport,
  espnGames: EspnGame[],
): EspnGame | null {
  return (
    espnGames.find(
      (g) =>
        String(g.homeAbbr ?? "").toUpperCase() === report.homeAbbr.toUpperCase() &&
        String(g.awayAbbr ?? "").toUpperCase() === report.awayAbbr.toUpperCase(),
    ) ??
    espnGames.find(
      (g) =>
        teamNameMatches(g.homeTeam, report.homeTeam) &&
        teamNameMatches(g.awayTeam, report.awayTeam),
    ) ??
    null
  );
}

/** Infer turf/grass from known stadium name hints when API omits surface. */
function surfaceFromParkName(parkName: string, climateControlled: boolean): "turf" | "grass" | null {
  const n = parkName.toLowerCase();
  if (/turf|sofi|ford field|lucasoil|nrg|mercedes|us bank|allegiant|caesars|metlife|gillette|empower/.test(n)) {
    return "turf";
  }
  if (climateControlled) return "turf";
  if (/lambeau|arrowhead|soldier|lincoln financial|acrisure|raymond james|hard rock/.test(n)) {
    return "grass";
  }
  return null;
}

function sliceFromReport(
  report: ParkWeatherReport,
  sport: string,
): FootballGameEnvSlice {
  const surface = surfaceFromParkName(report.parkName, report.climateControlled);
  const homeCoach = lookupFootballCoach(sport, report.homeAbbr);
  const awayCoach = lookupFootballCoach(sport, report.awayAbbr);
  return {
    park: {
      dome: report.climateControlled,
      surface,
    },
    weather: {
      tempF: report.current?.tempF ?? null,
      windMph: report.current?.windMph ?? null,
      condition: report.current?.condition ?? null,
      precipChancePct: report.current?.precipChancePct ?? null,
    },
    climateControlled: report.climateControlled,
    impactRating: report.impact?.rating ?? null,
    coaches: {
      home: homeCoach
        ? { name: homeCoach.name, aggressive: homeCoach.aggressive, favLean: homeCoach.favLean }
        : null,
      away: awayCoach
        ? { name: awayCoach.name, aggressive: awayCoach.aggressive, favLean: awayCoach.favLean }
        : null,
    },
  };
}

export type FootballScanContext = {
  /** Game-label → env (compatible with mlbGameEnv map consumers). */
  footballGameEnv: Record<string, FootballGameEnvSlice>;
};

/**
 * Load NFL + NCAAF park weather for games on the board.
 * Sports with no football slate short-circuit to {}. Failures return {}.
 */
export async function loadFootballScanContext(opts: {
  espnGames: EspnGame[];
  sports?: readonly string[];
  signal?: AbortSignal;
}): Promise<FootballScanContext> {
  const footballGameEnv: Record<string, FootballGameEnvSlice> = {};
  const boardSports = new Set(
    (opts.sports?.length
      ? opts.sports
      : opts.espnGames.map((g) => String(g.sport ?? "").toLowerCase())
    ).map((s) => String(s).toLowerCase()),
  );
  const wantNfl = boardSports.has("nfl");
  const wantNcaaf = boardSports.has("ncaaf");
  if (!wantNfl && !wantNcaaf) return { footballGameEnv };

  const fetches: Array<Promise<ParkWeatherReport[]>> = [];
  if (wantNfl) {
    fetches.push(getParkWeather("nfl", opts.signal).catch(() => []));
  } else {
    fetches.push(Promise.resolve([]));
  }
  if (wantNcaaf) {
    fetches.push(getParkWeather("ncaaf", opts.signal).catch(() => []));
  } else {
    fetches.push(Promise.resolve([]));
  }

  const [nflReports, ncaafReports] = await Promise.all(fetches);
  const bySport: Array<{ sport: string; reports: ParkWeatherReport[] }> = [
    { sport: "nfl", reports: nflReports },
    { sport: "ncaaf", reports: ncaafReports },
  ];

  for (const { sport, reports } of bySport) {
    const sportGames = opts.espnGames.filter(
      (g) => String(g.sport ?? "").toLowerCase() === sport,
    );
    for (const report of reports) {
      const game = matchReportToGame(report, sportGames.length ? sportGames : opts.espnGames);
      const slice = sliceFromReport(report, sport);
      if (game) {
        const away = game.awayTeam || game.awayAbbr || report.awayTeam;
        const home = game.homeTeam || game.homeAbbr || report.homeTeam;
        footballGameEnv[gameKey(away, home)] = slice;
        if (game.awayAbbr && game.homeAbbr) {
          footballGameEnv[gameKey(game.awayAbbr, game.homeAbbr)] = slice;
        }
      } else {
        footballGameEnv[gameKey(report.awayTeam, report.homeTeam)] = slice;
        footballGameEnv[gameKey(report.awayAbbr, report.homeAbbr)] = slice;
      }
    }
  }

  return { footballGameEnv };
}
