import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson } from "../lib/sports";

const router: IRouter = Router();

type SchedComp = {
  id?: string;
  date?: string;
  status?: { type?: { state?: string; completed?: boolean } };
  competitors?: Array<{ team?: { id?: string }; homeAway?: string }>;
};
type SchedResp = { events?: Array<{ id?: string; date?: string; competitions?: SchedComp[] }> };

type SbLinescore = { value?: number | null };
type SbCompetitor = { team?: { id?: string }; linescores?: SbLinescore[] };
type SbEvent = { id?: string; competitions?: Array<{ competitors?: SbCompetitor[] }> };
type SbResp = { events?: SbEvent[] };

// Sports where (a) ESPN scoreboard reliably exposes per-period linescores
// and (b) the bookmaker odds feed actually carries period markets we'd be
// helping the AI reason about. NBA / NFL / NCAAF qualify on both fronts.
// NCAAB has linescores but no 1H/2H markets in our feed; NHL has 3 periods
// and MLB has innings — none of those yield a period-betting use case here.
const SUPPORTED = new Set(["nba", "nfl", "ncaaf"]);

function yyyymmdd(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

// ESPN's scoreboard `dates=YYYYMMDD` filter uses the game's US local date,
// NOT the UTC date. A 7pm PT tipoff is "today" locally but tomorrow in UTC.
// Return both candidate date buckets so the lookup hits whichever ESPN used.
function candidateScoreboardDates(iso: string): string[] {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return [];
  const dates = new Set<string>();
  // Shift back 4h (East coast) and 8h (West coast) — that range covers
  // every US-broadcast tipoff that crosses the UTC date boundary.
  for (const offsetH of [0, -4, -8]) {
    const shifted = new Date(t + offsetH * 60 * 60 * 1000).toISOString();
    const ymd = yyyymmdd(shifted);
    if (ymd) dates.add(ymd);
  }
  return Array.from(dates);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Aggregate per-quarter (or per-half) team linescores from the last N
// completed games into average points scored & allowed. Pulls each game's
// linescore from the scoreboard endpoint (the team-schedule feed doesn't
// include linescores). Past games never change, so the scoreboard fetch is
// cached for 24h — after warm-up this is effectively free per send.
async function fetchTeamPeriodStats(sport: string, teamId: string) {
  const path = ESPN_SPORT_PATHS[sport];
  if (!path) return null;

  const schedKey = `team-period:sched:${sport}:${teamId}`;
  const sched = await cachedJson<SchedResp | null>(schedKey, 30 * 60 * 1000, async () => {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/schedule`);
    return r.ok ? ((await r.json()) as SchedResp) : null;
  });
  if (!sched) return null;

  // Last 10 completed games, newest first.
  const finished = (sched.events ?? [])
    .filter((e) => {
      const st = e.competitions?.[0]?.status?.type;
      return !!(st?.completed || st?.state === "post");
    })
    .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
    .slice(0, 10);

  if (finished.length === 0) {
    return { teamId, sport, sampleSize: 0, periodAverages: null };
  }

  // Bucket games by every candidate scoreboard date — the lookup below
  // accepts whichever date ESPN actually files the event under.
  const dateToEvents = new Map<string, Set<string>>();
  for (const ev of finished) {
    const eventId = ev.id;
    const iso = ev.date;
    if (!eventId || !iso) continue;
    for (const date of candidateScoreboardDates(iso)) {
      const arr = dateToEvents.get(date) ?? new Set<string>();
      arr.add(eventId);
      dateToEvents.set(date, arr);
    }
  }

  // Dedup: an event is only counted once even if it appears in multiple
  // candidate-date scoreboards (e.g. a 7pm PT tip shows up in both 5/20 and
  // 5/21 if both were probed).
  const seenEvents = new Set<string>();
  const periodLogs: Array<{ scored: number[]; allowed: number[] }> = [];

  await Promise.all(
    Array.from(dateToEvents.entries()).map(async ([date, eventIds]) => {
      const sbKey = `team-period:sb:${sport}:${date}`;
      const sb = await cachedJson<SbResp | null>(sbKey, 24 * 60 * 60 * 1000, async () => {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${date}`);
        return r.ok ? ((await r.json()) as SbResp) : null;
      });
      if (!sb) return;
      for (const eventId of eventIds) {
        if (seenEvents.has(eventId)) continue;
        const game = sb.events?.find((g) => g.id === eventId);
        if (!game) continue;
        const comps = game.competitions?.[0]?.competitors ?? [];
        const me = comps.find((c) => c.team?.id === String(teamId));
        const opp = comps.find((c) => c.team?.id !== String(teamId));
        if (!me || !opp) continue;
        const myLs = (me.linescores ?? []).map((x) => (typeof x.value === "number" ? x.value : null));
        const oppLs = (opp.linescores ?? []).map((x) => (typeof x.value === "number" ? x.value : null));
        if (myLs.length === 0 || myLs.length !== oppLs.length) continue;
        if (myLs.some((v) => v == null) || oppLs.some((v) => v == null)) continue;
        seenEvents.add(eventId);
        periodLogs.push({ scored: myLs as number[], allowed: oppLs as number[] });
      }
    }),
  );

  if (periodLogs.length === 0) {
    return { teamId, sport, sampleSize: 0, periodAverages: null };
  }

  // Use the shortest linescore length across the sample as the period count,
  // in case ESPN ever returns mixed shapes (overtime games would otherwise
  // skew). Trim every entry to that length before averaging.
  const periodCount = Math.min(...periodLogs.map((p) => p.scored.length));
  const sumAt = (idx: number, side: "scored" | "allowed") =>
    periodLogs.reduce((a, p) => a + p[side][idx], 0);
  const avgAt = (idx: number, side: "scored" | "allowed") => sumAt(idx, side) / periodLogs.length;

  const periodAverages: Record<string, { scored: number; allowed: number }> = {};

  if (periodCount === 4) {
    // 4-quarter sports: report q1-q4 + h1/h2.
    for (let i = 0; i < 4; i++) {
      periodAverages[`q${i + 1}`] = { scored: round1(avgAt(i, "scored")), allowed: round1(avgAt(i, "allowed")) };
    }
    periodAverages.h1 = { scored: round1(avgAt(0, "scored") + avgAt(1, "scored")), allowed: round1(avgAt(0, "allowed") + avgAt(1, "allowed")) };
    periodAverages.h2 = { scored: round1(avgAt(2, "scored") + avgAt(3, "scored")), allowed: round1(avgAt(2, "allowed") + avgAt(3, "allowed")) };
  } else if (periodCount === 2) {
    // 2-half sports (NCAAB): report h1/h2 only.
    periodAverages.h1 = { scored: round1(avgAt(0, "scored")), allowed: round1(avgAt(0, "allowed")) };
    periodAverages.h2 = { scored: round1(avgAt(1, "scored")), allowed: round1(avgAt(1, "allowed")) };
  } else {
    // Unexpected shape — return sample but no averages rather than fabricate.
    return { teamId, sport, sampleSize: periodLogs.length, periodAverages: null };
  }

  return { teamId, sport, sampleSize: periodLogs.length, periodAverages };
}

router.get("/sports/team-period-stats", async (req, res): Promise<void> => {
  const sport = String(req.query.sport || "").toLowerCase();
  const teamId = String(req.query.teamId || "");
  if (!sport || !teamId) {
    res.status(400).json({ error: "Missing sport or teamId" });
    return;
  }
  if (!SUPPORTED.has(sport)) {
    // Honest empty for sports without period markets we model — caller can skip.
    res.json({ teamId, sport, sampleSize: 0, periodAverages: null, supported: false });
    return;
  }
  try {
    const key = `team-period-stats:${sport}:${teamId}`;
    const out = await cachedJson(key, 2 * 60 * 60 * 1000, async () => {
      const result = await fetchTeamPeriodStats(sport, teamId);
      return result ?? { teamId, sport, sampleSize: 0, periodAverages: null };
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
