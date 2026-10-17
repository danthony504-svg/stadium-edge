/**
 * Client-shaped checks against the isolated staging API of this SHA.
 * Prints one JSON report. Does not deploy.
 */
import { performance } from "node:perf_hooks";
import {
  publishedClientHitForPick,
  publishedClientWouldRescalePeriodCovers,
} from "../src/lib/gameOutcomePayload.ts";
import { withCoachGameSimCache } from "../../stadium-mobile/lib/coachContextCache.ts";
import { gameDrawEngineAccepted } from "../../stadium-mobile/lib/gameSimEngineVersion.ts";
import { parseCoachAskMarketConstraint, filterPicksByAskMarketConstraint } from "../../stadium-mobile/lib/coachAskMarketFilter.ts";
import { coachAbsoluteBudgetMs, coachRequestDeadlineMs } from "../../stadium-mobile/lib/coach/session.ts";
import { coachTerminalLiveDeadlineMs } from "../../stadium-mobile/lib/coachQa/terminalInvariant.ts";

const base = process.env.STAGING_BASE ?? "http://127.0.0.1:8099";
const ASK = "4 leg NFL spreads and moneylines for upcoming games.";

async function timed<T>(label: string, run: () => Promise<T>): Promise<{ label: string; ms: number; value: T }> {
  const t0 = performance.now();
  const value = await run();
  return { label, ms: Math.round(performance.now() - t0), value };
}

async function main(): Promise<number> {
  const health = await timed("health", async () => {
    const res = await fetch(`${base}/api/health`);
    return { status: res.status, body: await res.json() };
  });

  const games = await timed("nfl-games", async () => {
    const res = await fetch(`${base}/api/sports/games?sport=nfl`);
    const body = await res.json();
    const rows = Array.isArray(body) ? body : [];
    return { status: res.status, count: rows.length, rows };
  });

  const slate = (games.value.rows as Array<Record<string, unknown>>)
    .filter((g) => g.homeTeamId && g.awayTeamId)
    .slice(0, 4);

  const failure = await timed("missing-teams", async () => {
    const res = await fetch(`${base}/api/sports/simulate/game-outcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sport: "nfl" }),
    });
    return { status: res.status, body: await res.json() };
  });

  const first = slate[0];
  const fullQueries = [
    { id: "fg-ml", kind: "ml", teamSide: "home", period: "fg" },
    { id: "fg-spread", kind: "spread", teamSide: "away", line: 3.5, period: "fg" },
  ];
  const mixedQueries = [
    ...fullQueries,
    { id: "q3-ml", kind: "ml", teamSide: "home", period: "q3" },
    { id: "q3-spread", kind: "spread", teamSide: "home", line: 1.5, period: "q3" },
  ];

  async function simulate(queries: typeof fullQueries, signal?: AbortSignal) {
    const res = await fetch(`${base}/api/sports/simulate/game-outcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        sport: "nfl",
        homeTeamId: first?.homeTeamId,
        awayTeamId: first?.awayTeamId,
        homeTeam: first?.homeTeam,
        awayTeam: first?.awayTeam,
        simulations: 10000,
        coverQueries: queries,
        retainOutcomes: true,
      }),
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  const fullGame = first
    ? await timed("nfl-full-game-10k", () => simulate(fullQueries))
    : null;
  const mixed = first
    ? await timed("nfl-mixed-fg-q3-10k", () => simulate(mixedQueries))
    : null;

  const cancel = first
    ? await timed("cancel-inflight-sim", async () => {
        const ac = new AbortController();
        const started = performance.now();
        const pending = simulate(fullQueries, ac.signal).then(
          async (value) => ({
            settled: "response" as const,
            status: value.status,
            engineVersion: value.body.engineVersion ?? null,
          }),
          (err: unknown) => ({
            settled: "aborted" as const,
            name: err instanceof Error ? err.name : String(err),
          }),
        );
        ac.abort();
        const result = await pending;
        return { abortAfterMs: Math.round(performance.now() - started), result };
      })
    : null;

  const ask = parseCoachAskMarketConstraint(ASK);
  const filtered = filterPicksByAskMarketConstraint(
    [
      { isProp: true, market: "Rec Yds", pick: "Player Over 50.5" },
      { isProp: false, market: "Q3 Spread", pick: "Seahawks +1.5" },
      { isProp: false, market: "Spread", pick: "Seahawks +3.5" },
      { isProp: false, market: "Moneyline", pick: "Broncos" },
    ],
    ask,
  );

  const mixedBody = mixed?.value.body as {
    engineVersion?: string;
    simulations?: number;
    homeWinProbability?: number;
    awayWinProbability?: number;
    coverHitRates?: Record<string, number>;
    outcomes?: { homeScores?: number[] };
    homeProjectedScore?: number;
    awayProjectedScore?: number;
  } | undefined;

  const publishedPeriodMl = mixedBody
    ? publishedClientHitForPick(mixedBody, { id: "q3-ml", kind: "ml", period: "q3", teamSide: "home" })
    : null;
  const publishedPeriodSpread = mixedBody
    ? publishedClientHitForPick(mixedBody, { id: "q3-spread", kind: "spread", period: "q3", teamSide: "home" })
    : null;
  const publishedFullMl = mixedBody
    ? publishedClientHitForPick(mixedBody, { id: "fg-ml", kind: "ml", period: "fg", teamSide: "home" })
    : null;

  const unstamped = await withCoachGameSimCache(
    "ppg-per-drive-v1|staging|unstamped",
    async () => ({ sport: "nfl", simulations: 10000, homeWinProbability: 0.5, awayWinProbability: 0.5 }),
    undefined,
    (draw) => draw == null || gameDrawEngineAccepted(draw, "nfl"),
  );
  const stamped = await withCoachGameSimCache(
    "ppg-per-drive-v1|staging|stamped",
    async () => mixedBody ?? null,
    undefined,
    (draw) => draw == null || gameDrawEngineAccepted(draw, "nfl"),
  );

  const legs = [];
  const askStarted = performance.now();
  for (const game of slate) {
    const leg = await timed(`ask-game-${game.awayTeamId}-at-${game.homeTeamId}`, async () => {
      const res = await fetch(`${base}/api/sports/simulate/game-outcome`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sport: "nfl",
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          simulations: 10000,
          coverQueries: fullQueries,
          retainOutcomes: true,
        }),
      });
      const body = await res.json();
      return {
        status: res.status,
        engineVersion: body.engineVersion ?? null,
        homeProjectedScore: body.homeProjectedScore ?? null,
        awayProjectedScore: body.awayProjectedScore ?? null,
        hasOutcomes: Boolean(body.outcomes?.homeScores?.length),
      };
    });
    legs.push(leg);
  }

  const report = {
    base,
    ask: ASK,
    askParse: {
      fullGameOnly: ask.fullGameOnly,
      gameLinesOnly: ask.gameLinesOnly,
      propsOnly: ask.propsOnly,
      keptMarkets: filtered.map((p) => p.market),
    },
    deadlineMs: {
      request: coachRequestDeadlineMs(4),
      absolute: coachAbsoluteBudgetMs(4),
      terminal: coachTerminalLiveDeadlineMs(4),
      oneClock: coachRequestDeadlineMs(4) === coachTerminalLiveDeadlineMs(4),
    },
    health: { ms: health.ms, ...health.value },
    games: { ms: games.ms, status: games.value.status, count: games.value.count, used: slate.length },
    failure: { ms: failure.ms, ...failure.value },
    fullGame: fullGame && {
      ms: fullGame.ms,
      status: fullGame.value.status,
      engineVersion: fullGame.value.body.engineVersion ?? null,
      homeProjectedScore: fullGame.value.body.homeProjectedScore ?? null,
      awayProjectedScore: fullGame.value.body.awayProjectedScore ?? null,
      hasOutcomes: Boolean(fullGame.value.body.outcomes?.homeScores?.length),
    },
    mixed: mixed && {
      ms: mixed.ms,
      status: mixed.value.status,
      engineVersion: mixedBody?.engineVersion ?? null,
      hasOutcomes: Boolean(mixedBody?.outcomes?.homeScores?.length),
      wouldRescale: mixedBody ? publishedClientWouldRescalePeriodCovers(mixedBody) : null,
      q3MlRate: mixedBody?.coverHitRates?.["q3-ml"] ?? null,
      q3SpreadRate: mixedBody?.coverHitRates?.["q3-spread"] ?? null,
      fgMlRate: mixedBody?.coverHitRates?.["fg-ml"] ?? null,
      publishedPeriodMl,
      publishedPeriodSpread,
      publishedFullMl,
    },
    cancel: cancel && { ms: cancel.ms, ...cancel.value },
    cache: {
      unstampedStored: unstamped != null,
      stampedEngine: stamped && typeof stamped === "object" && "engineVersion" in stamped ? stamped.engineVersion : null,
    },
    askLegs: legs.map((leg) => ({ label: leg.label, ms: leg.ms, ...leg.value })),
    askTotalMs: Math.round(performance.now() - askStarted),
  };
  console.log(JSON.stringify(report, null, 2));
  const ok =
    report.health.status === 200 &&
    report.failure.status === 400 &&
    report.deadlineMs.oneClock &&
    report.askParse.fullGameOnly === true &&
    report.cache.unstampedStored === false &&
    (report.mixed == null ||
      (report.mixed.hasOutcomes === false &&
        report.mixed.wouldRescale === false &&
        report.mixed.publishedPeriodMl == null &&
        report.mixed.publishedPeriodSpread == null &&
        report.mixed.engineVersion === "ppg-per-drive-v1"));
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
