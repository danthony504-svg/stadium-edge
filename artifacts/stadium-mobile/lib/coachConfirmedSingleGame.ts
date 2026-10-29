/** Resolve a one-game slate only with independent, matching schedule and odds evidence.
 * Never infer it from a partially scored candidate pool or a failed source.
 * Pure and in-memory: no extra requests, simulations or longer deadlines.
 */
export function confirmedSingleGameAsk(opts: {
  askText: string; sports: readonly string[]; maxGames?: number | null;
  oddsGames: readonly { sport: string; awayTeam: string; homeTeam: string; commenceTime: string }[];
  scheduleGames: readonly { sport: string; awayTeam?: string | null; homeTeam?: string | null; startsAt: string }[];
  now?: number;
}): string {
  const { askText } = opts;
  const now = opts.now ?? Date.now();
  // ESPN includes later weeks. Compare the same pregame 48-hour window as Coach.
  if (opts.scheduleGames.some(game => !Number.isFinite(Date.parse(game.startsAt)))) return askText;
  const scheduleWindow = opts.scheduleGames.filter(game => {
    const start = Date.parse(game.startsAt);
    return start > now && start < now + 48 * 3600_000;
  });
  if (opts.sports.length !== 1 || (opts.maxGames != null && opts.maxGames > 1)
    || /\b(multiple|different|separate)\s+games\b|\bacross\b/i.test(askText)
    || opts.oddsGames.length !== 1 || scheduleWindow.length !== 1) return askText;
  const odds = opts.oddsGames[0]!, schedule = scheduleWindow[0]!;
  const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const away = normalize(odds.awayTeam), home = normalize(odds.homeTeam);
  const kickoff = Date.parse(odds.commenceTime), scheduled = Date.parse(schedule.startsAt);
  if (!away || !home || away === home || away !== normalize(schedule.awayTeam) || home !== normalize(schedule.homeTeam)
    || normalize(odds.sport) !== normalize(schedule.sport) || normalize(odds.sport) !== normalize(opts.sports[0])
    || !Number.isFinite(kickoff) || !Number.isFinite(scheduled) || (kickoff <= now || kickoff >= now + 48 * 3600_000)
    || Math.abs(kickoff - scheduled) > 5 * 60_000) return askText;
  return `${askText} — same game: ${odds.awayTeam} @ ${odds.homeTeam}`;
}
