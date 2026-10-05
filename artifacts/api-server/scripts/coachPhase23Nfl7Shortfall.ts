/**
 * NFL 7 shortfall diagnosis — where the 7th leg disappears.
 * Report only; do not lower thresholds.
 */
import { writeFileSync } from "node:fs";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { clearAuthoritativePlayerHistoryForTests } from "../src/lib/authoritativePlayerHistory.ts";
import { runPropSims, tierSimCount } from "../src/lib/propSimRunner.ts";
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import { keyInjuryWeight, type SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { teamPace } from "../src/lib/statmuse.ts";
import type { SimTier } from "../src/lib/simCache.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";

const HARD_MS = 300_000;

function teamInjuryWeight(
  teams: Awaited<ReturnType<typeof fetchEspnInjuries>>,
  teamName: string,
): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const target = norm(teamName);
  const team = teams.find((t) => {
    const n = norm(t.team ?? "");
    return n.includes(target) || target.includes(n);
  });
  return keyInjuryWeight(team?.entries);
}

async function main() {
  clearCoachContextCache();
  clearPropSimDedicatedStoresForTests();
  clearAthleteIdentityStoreForTests();
  clearAuthoritativePlayerHistoryForTests();
  resetCoachCacheStats();

  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (url.includes("/sports/simulate/props") && String(init?.method ?? "GET").toUpperCase() === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const sport = String(body.sport ?? "").toLowerCase();
      const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
      const props = (body.props ?? []) as SimPropRequest[];
      const homeTeam = String(body.homeTeam ?? "");
      const awayTeam = String(body.awayTeam ?? "");
      const { props: propsResolved } = await resolvePropAthleteIdsDetailed(
        sport,
        props.map((p) => ({ ...p, sport: String(p.sport ?? sport).toLowerCase() })),
        {
          homeTeamId: String(body.homeTeamId ?? "").trim(),
          awayTeamId: String(body.awayTeamId ?? "").trim(),
          homeTeam,
          awayTeam,
        },
      );
      const injuries = await fetchEspnInjuries(sport);
      let oppPace: number | null = null;
      let leaguePace: number | null = 100;
      if ((sport === "nba" || sport === "wnba") && homeTeam && awayTeam) {
        try {
          const [a, b] = await Promise.all([teamPace(sport, homeTeam), teamPace(sport, awayTeam)]);
          if (a != null && b != null) {
            oppPace = (a + b) / 2;
          }
        } catch {
          /* optional */
        }
      }
      const { rows, deepPending, distStats, propSimElapsedMs, playerHistories, historyShared, historyCoalesced } =
        await runPropSims(
          propsResolved,
          tier,
          {
            sport,
            oppPace,
            leaguePace,
            oppKeyInjuries: awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0,
            ownKeyInjuries: homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0,
            weatherImpact: null,
          },
          (body.isHomeByPlayer ?? {}) as Record<string, boolean>,
          body.simulations != null ? Number(body.simulations) : undefined,
        );
      return new Response(
        JSON.stringify({
          sport,
          tier,
          simulations: tierSimCount(tier),
          deepPending,
          props: rows,
          playerHistories,
          historyShared,
          historyCoalesced,
          propSimElapsedMs,
          ...distStats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return orig(input, init);
  }) as typeof fetch;

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: 7,
      askText: "7 leg NFL",
      priorUserTexts: [],
      signal: ac.signal,
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }

  const diag = result.scan?.failureDiagnostics ?? result.failureDiagnostics ?? null;
  const ticket = (result.picks ?? []).map((p) => ({
    pick: p.pick,
    isProp: !!p.isProp,
    market: p.market,
    game: p.game,
    sport: p.sport,
    grade: p.finalAiScore?.grade ?? p.scores?.grade ?? null,
    edge: p.finalAiScore?.edge ?? null,
    simHit: p.finalAiScore?.simHit ?? null,
  }));

  // Group ticket by game to show same-game stack
  const byGame = new Map<string, typeof ticket>();
  for (const t of ticket) {
    const g = t.game || "?";
    const arr = byGame.get(g) ?? [];
    arr.push(t);
    byGame.set(g, arr);
  }

  const funnel = {
    requested: 7,
    returned: ticket.length,
    shortfall: ticket.length < 7,
    eligiblePosted: {
      propPoolSize: diag?.propPoolSize ?? null,
      oddsGameCount: diag?.oddsGameCount ?? null,
      gameEntryCount: diag?.gameEntryCount ?? null,
    },
    simulated: {
      gameSimsLoaded: diag?.gameSimsLoaded ?? null,
      gameLegsScored: diag?.gameLegsScored ?? null,
      propSimEvaluated: diag?.propSimEvaluated ?? null,
      propLegsScored: diag?.propLegsScored ?? null,
    },
    qualified: {
      scoredBeforeStage: diag?.scoredBeforeStage ?? null,
    },
    staging: {
      requirePropMix: diag?.requirePropMix ?? null,
      note: (result.note || "").slice(0, 400),
    },
    final: ticket,
    sameGameStacks: [...byGame.entries()].map(([game, legs]) => ({
      game,
      count: legs.length,
      legs: legs.map((l) => `${l.market}: ${l.pick}`),
    })),
  };

  // Exact disappearance point
  const scored = diag?.scoredBeforeStage ?? 0;
  const disappearance =
    scored >= 7 && ticket.length === 6
      ? "staging_correlation_diversity_or_per_game_cap"
      : scored < 7 && (diag?.propLegsScored ?? 0) + (diag?.gameLegsScored ?? 0) >= 7
        ? "qualification_threshold"
        : scored < 7
          ? "insufficient_qualified_after_sim_grade"
          : "unknown";

  const report = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    funnel,
    disappearance,
    analysis:
      disappearance === "staging_correlation_diversity_or_per_game_cap"
        ? "Board produced enough qualified candidates (scoredBeforeStage ≥ 7) but staging could only place 6 without violating per-game / correlation / prop-mix / diversity caps. Another legitimate qualified candidate existed in the qualified pool but was excluded by staging policy — not by empty board or lowered thresholds."
        : disappearance === "qualification_threshold"
          ? "Enough legs were simulated/scored but fewer than 7 cleared the quality bar."
          : "Not enough qualified candidates after sim/grade.",
    anotherLegitimateQualifiedAvailable:
      disappearance === "staging_correlation_diversity_or_per_game_cap",
    doNot: "Do not lower thresholds or add filler.",
  };

  writeFileSync("/opt/cursor/artifacts/coach-phase23-nfl7-shortfall.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
