import { getGames, getInjuries, getTeamDefense } from "./api";
import { DEFAULT_SPORTS } from "./sports";
import { peekCoachContextCache } from "./coachContextCache";
import type { CoachWarmTask } from "./coachContextWarmup";

/** Same GETs / keys / TTLs as foreground Coach. Odds remain request-time data. */
export function coachContextWarmTasks(): CoachWarmTask[] {
  const upcomingFor = (sport: string): CoachWarmTask[] => {
    const games = peekCoachContextCache<Awaited<ReturnType<typeof getGames>>>(`/sports/games?sport=${sport}`) ?? [];
    const live = games.filter(g => {
      const at = Date.parse(g.startsAt ?? "");
      return at > Date.now() && at < Date.now() + 48 * 60 * 60_000;
    }).sort((a, b) => Date.parse(a.startsAt ?? "") - Date.parse(b.startsAt ?? "")).slice(0, 2);
    if (!live.length || ["tennis", "ufc"].includes(sport)) return [];
    return [
      { key: `injuries:${sport}`, run: () => getInjuries(sport) },
      ...[...new Set(live.flatMap(g => [g.homeTeamId, g.awayTeamId]).filter((id): id is string => !!id))]
        .map(id => ({ key: `defense:${sport}:${id}`, run: () => getTeamDefense(sport, id) })),
    ];
  };
  const upcoming = DEFAULT_SPORTS.flatMap(upcomingFor);
  const schedules = DEFAULT_SPORTS.map(sport => ({
    key: `schedule:${sport}`,
    run: () => getGames(sport),
    followups: () => upcomingFor(sport),
  }));
  // Rotate schedules behind context for sports already known to be upcoming.
  // Each pass is bounded and one-wide; foreground work clears the queue.
  return [...upcoming, ...schedules];
}
