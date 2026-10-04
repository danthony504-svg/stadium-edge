/**
 * Production-equivalent Coach replay: "6 leg NHL not the ducks"
 * Full pipeline: board load → exclusion → deep MC → grade → stage → ticket.
 * Report-only — no merge/OTA/deploy/build.
 *
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coachNhlDucksExcludeReplay.ts
 */
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  coachAskTeamScope,
  excludedTeamScopesFromText,
  filterOddsGamesExcludingTeams,
  resolveExcludedTeamIdsFromGames,
} from "../../stadium-mobile/lib/coachAskTeamScope.ts";
import { parseRequestedLegs, resolveBuildLegTarget } from "../../stadium-mobile/lib/coach/parseAsk.ts";
import { coachBoardSportsForAsk } from "../../stadium-mobile/lib/coachPropBoardCoverage.ts";
import { focalSportsFromText } from "../../stadium-mobile/lib/chatContextPriority.ts";
import { filterBettableOddsGames } from "../../stadium-mobile/lib/slate.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";

const ASK = "6 leg NHL not the ducks";
const HARD_TIMEOUT_MS = 180_000;
const ALL = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "nfl",
  "ncaaf",
  "ncaab",
];

function isDucksLabel(label: string): boolean {
  return /ducks|anaheim/i.test(label);
}

function countOutcomes(
  games: Array<{ markets?: Array<{ key?: string; outcomes?: unknown[] }> }>,
): { main: number; alt: number; all: number } {
  let main = 0;
  let alt = 0;
  let all = 0;
  for (const g of games) {
    for (const m of g.markets ?? []) {
      const n = (m.outcomes ?? []).length;
      all += n;
      if (String(m.key ?? "").includes("alternate")) alt += n;
      else main += n;
    }
  }
  return { main, alt, all };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  const t0 = performance.now();
  const statuses: string[] = [];

  type OddsGame = {
    id: string;
    sport: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime: string;
    markets?: Array<{ key?: string; outcomes?: unknown[] }>;
  };
  type EspnGame = {
    id: string;
    sport: string;
    homeTeam: string;
    awayTeam: string;
    homeTeamId?: string;
    awayTeamId?: string;
  };

  const [oddsRaw, espnRaw] = await Promise.all([
    getJson<OddsGame[]>("/sports/odds?sport=nhl"),
    getJson<EspnGame[]>("/sports/games?sport=nhl"),
  ]);

  const bettable = filterBettableOddsGames(oddsRaw);
  const teamScope = coachAskTeamScope(ASK);
  let excluded = excludedTeamScopesFromText(ASK);
  excluded = resolveExcludedTeamIdsFromGames(excluded, espnRaw);
  const afterGames = filterOddsGamesExcludingTeams(bettable, excluded);
  const removedGames = bettable.filter(
    (g) => !afterGames.some((x) => x.id === g.id),
  );

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_TIMEOUT_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: resolveBuildLegTarget(ASK),
      askText: ASK,
      signal: ac.signal,
      onStatus: (s) => statuses.push(s),
    });
  } finally {
    clearTimeout(kill);
  }

  const picks = result.picks ?? [];
  const scan = result.scan;
  const manifest = scan?.manifest;
  const diag = scan?.failureDiagnostics;

  const ducksOnTicket = picks.filter((p) => isDucksLabel(String(p.game ?? "")));
  const finalEvents = picks.map((p) => ({
    game: p.game,
    market: p.market,
    pick: p.pick,
    odds: p.odds,
    isProp: !!p.isProp,
    sport: p.sport ?? null,
    grade: p.finalAiScore?.grade ?? null,
    recommends: p.finalAiScore?.recommends ?? null,
    edgePct: p.finalAiScore?.edgePct ?? null,
    simHit: p.finalAiScore?.simHit ?? null,
  }));

  const report = {
    ask: ASK,
    apiBase: API_BASE,
    elapsedMs: Math.round(performance.now() - t0),
    timedOut: result.timedOut,
    requestedLegs: parseRequestedLegs(ASK),
    resolveBuildLegTarget: resolveBuildLegTarget(ASK),
    sport: {
      focal: [...focalSportsFromText(ASK)],
      board: coachBoardSportsForAsk(ASK, 6, ALL),
    },
    teamScope,
    excludedTeams: excluded,
    excludedEvents: removedGames.map((g) => ({
      eventId: g.id,
      label: `${g.awayTeam} @ ${g.homeTeam}`,
      commenceTime: g.commenceTime,
    })),
    gamesBeforeExclusion: bettable.length,
    gamesAfterExclusion: afterGames.length,
    gamesAfterLabels: afterGames.map((g) => `${g.awayTeam} @ ${g.homeTeam}`),
    candidatesRemovedByExclusion: {
      games: removedGames.length,
      outcomes: countOutcomes(removedGames),
    },
    remainingBoardOutcomes: countOutcomes(afterGames),
    propPoolSize: result.propPoolSize,
    candidatesSimulatedGraded: {
      totalScanned: scan?.totalScanned ?? null,
      totalEvaluated: manifest?.totalEvaluated ?? null,
      propsFound: manifest?.propsFound ?? null,
      propsSimulated: manifest?.propsSimulated ?? null,
      gameLegsScored: diag?.gameLegsScored ?? null,
      propLegsScored: diag?.propLegsScored ?? null,
      scoredBeforeStage: diag?.scoredBeforeStage ?? null,
      propSimEvaluated: diag?.propSimEvaluated ?? null,
    },
    qualifiedCandidates:
      manifest?.totalQualified ??
      scan?.totalQualified ??
      diag?.scoredBeforeStage ??
      null,
    finalTicketCount: picks.length,
    finalPicks: finalEvents,
    everyFinalPickEvent: picks.map((p) => String(p.game ?? "")),
    zeroFloridaAnaheimSelections: ducksOnTicket.length === 0,
    ducksSelectionsOnTicket: ducksOnTicket.length,
    shortfall:
      picks.length < 6
        ? `honest shortfall ${picks.length}/6 (exclusion held; Anaheim not restored)`
        : null,
    note: (result.note || "").slice(0, 500),
    statuses: statuses.slice(0, 40),
    scanComplete: scan?.scanComplete ?? null,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
