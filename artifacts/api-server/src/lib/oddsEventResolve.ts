export type OddsEventRow = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time?: string;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const nick = (s: string) => (s.toLowerCase().match(/[a-z]+/g) || []).pop() || "";

/** Pick the Odds API event id for an ESPN/Bovada game id + team names. */
export function resolveOddsEvent(
  events: OddsEventRow[],
  args: { eventId: string; homeName: string; awayName: string; startsAt?: string },
): OddsEventRow | null {
  const { eventId, homeName, awayName, startsAt } = args;
  const looksLikeOddsApiId = /^[a-f0-9]{32}$/i.test(eventId);
  if (looksLikeOddsApiId) {
    const byId = events.find((e) => e.id === eventId);
    if (byId) return byId;
  }
  if (!homeName || !awayName) return null;

  const wantHomeFull = norm(homeName);
  const wantAwayFull = norm(awayName);
  const fullMatches = events.filter((e) => {
    const eh = norm(e.home_team);
    const ea = norm(e.away_team);
    return (eh === wantHomeFull && ea === wantAwayFull) || (eh === wantAwayFull && ea === wantHomeFull);
  });

  if (fullMatches.length === 1) return fullMatches[0];

  if (fullMatches.length > 1 && startsAt) {
    const target = Date.parse(startsAt);
    if (Number.isFinite(target)) {
      let best: OddsEventRow | null = null;
      let bestDiff = Infinity;
      for (const e of fullMatches) {
        const t = Date.parse(e.commence_time ?? "");
        if (!Number.isFinite(t)) continue;
        const diff = Math.abs(t - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = e;
        }
      }
      // Same-day doubleheader / series: pick the commence time within 6h of ESPN.
      if (best && bestDiff <= 6 * 60 * 60 * 1000) return best;
    }
  }

  if (fullMatches.length === 0) {
    const wantHomeNick = nick(homeName);
    const wantAwayNick = nick(awayName);
    const nickMatches = events.filter((e) => {
      const eh = nick(e.home_team);
      const ea = nick(e.away_team);
      return (eh === wantHomeNick && ea === wantAwayNick) || (eh === wantAwayNick && ea === wantHomeNick);
    });
    if (nickMatches.length === 1) return nickMatches[0];
    if (nickMatches.length > 1 && startsAt) {
      const target = Date.parse(startsAt);
      if (Number.isFinite(target)) {
        let best: OddsEventRow | null = null;
        let bestDiff = Infinity;
        for (const e of nickMatches) {
          const t = Date.parse(e.commence_time ?? "");
          if (!Number.isFinite(t)) continue;
          const diff = Math.abs(t - target);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = e;
          }
        }
        if (best && bestDiff <= 6 * 60 * 60 * 1000) return best;
      }
    }
  }

  return null;
}
