/**
 * Shared ESPN NHL fetch + boxscore parsing for shadow eval (chrono OOS / A/B / diagnose).
 * Never used for production serve.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type NhlGame = {
  eventId: string;
  kickoffIso: string;
  homeId: string;
  awayId: string;
  homeFinal: number;
  awayFinal: number;
  homeReg: number;
  awayReg: number;
  season: number;
};

export type BoxPlayer = {
  athleteId: string;
  teamSide: "home" | "away";
  goals: number;
  sog: number;
  saves: number;
  isGoalie: boolean;
  /** Seconds of TOI when parseable; null if missing. */
  toiSeconds: number | null;
};

export function ymd(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/**
 * NHL season labeled by start year: Oct Y – Jun Y+1.
 * `stepDays=1` densifies vs historical every-2nd-day sampling.
 */
export function nhlSampleDays(startYear: number, stepDays = 1): string[] {
  const days: string[] = [];
  const step = Math.max(1, Math.floor(stepDays));
  for (const [y, months] of [
    [startYear, [10, 11, 12]],
    [startYear + 1, [1, 2, 3, 4, 5, 6]],
  ] as const) {
    for (const month of months) {
      const maxD = month === 2 ? 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
      for (let d = 1; d <= maxD; d += step) days.push(ymd(y, month, d));
    }
  }
  return days;
}

/**
 * Map ESPN boxscore column keys → goals / SOG / saves indices.
 * Critical: NHL skater SOG lives under `shotsTotal` (not `sog` / bare `shots`).
 */
export function boxStatIndices(keys: string[]): {
  goals: number;
  sog: number;
  saves: number;
  toi: number;
  isGoalieGrp: boolean;
} {
  const goals = keys.findIndex((k) => /^(g|goals)$/i.test(k));
  const sog = keys.findIndex((k) =>
    /^(sog|shotsOnGoal|shotsTotal|shots|s)$/i.test(k),
  );
  const saves = keys.findIndex((k) => /^(sv|saves)$/i.test(k));
  const toi = keys.findIndex((k) => /^(toi|timeOnIce)$/i.test(k));
  const isGoalieGrp = saves >= 0 && goals < 0;
  return { goals, sog, saves, toi, isGoalieGrp };
}

export function parseToiSeconds(raw: string | undefined): number | null {
  if (!raw || typeof raw !== "string") return null;
  const m = /^(\d+):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

async function parseScoreboard(
  url: string,
  season: number,
  out: NhlGame[],
  userAgent: string,
): Promise<void> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (!r.ok) return;
    const j = (await r.json()) as {
      events?: Array<{
        id?: string;
        date?: string;
        competitions?: Array<{
          competitors?: Array<{
            homeAway?: string;
            score?: string;
            team?: { id?: string };
            linescores?: Array<{ value?: number }>;
          }>;
          status?: { type?: { completed?: boolean } };
        }>;
      }>;
    };
    for (const ev of j.events ?? []) {
      const c = ev.competitions?.[0];
      if (!c?.status?.type?.completed || !ev.id || !ev.date) continue;
      const home = c.competitors?.find((x) => x.homeAway === "home");
      const away = c.competitors?.find((x) => x.homeAway === "away");
      if (!home?.team?.id || !away?.team?.id) continue;
      const homeFinal = Number(home.score);
      const awayFinal = Number(away.score);
      if (!Number.isFinite(homeFinal) || !Number.isFinite(awayFinal)) continue;
      const hLs = (home.linescores ?? []).map((x) => Number(x.value ?? 0));
      const aLs = (away.linescores ?? []).map((x) => Number(x.value ?? 0));
      if (hLs.length < 3 || aLs.length < 3) continue;
      out.push({
        eventId: ev.id,
        kickoffIso: ev.date,
        homeId: home.team.id,
        awayId: away.team.id,
        homeFinal,
        awayFinal,
        homeReg: hLs.slice(0, 3).reduce((s, v) => s + v, 0),
        awayReg: aLs.slice(0, 3).reduce((s, v) => s + v, 0),
        season,
      });
    }
  } catch {
    /* skip */
  }
}

export type FetchSeasonOpts = {
  /** Date-sample stride (1 = every day). Default 1. */
  stepDays?: number;
  /** Week fallback loop count. Default 28. */
  maxWeek?: number;
  userAgent?: string;
  delayMs?: number;
};

export async function fetchNhlSeason(
  season: number,
  opts: FetchSeasonOpts = {},
): Promise<NhlGame[]> {
  const stepDays = opts.stepDays ?? 1;
  const maxWeek = opts.maxWeek ?? 28;
  const userAgent = opts.userAgent ?? "stadium-sim-v2-nhl";
  const delayMs = opts.delayMs ?? 30;
  const cacheDir = join(import.meta.dirname, "cache");
  const cacheKey = `nhl_season_${season}_step${stepDays}_w${maxWeek}.json`;
  const cachePath = join(cacheDir, cacheKey);
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as NhlGame[];
    if (Array.isArray(parsed) && parsed.length > 100) {
      console.log(`nhl-cache hit ${cacheKey} n=${parsed.length}`);
      return parsed;
    }
  } catch {
    /* miss */
  }
  const games: NhlGame[] = [];
  for (const dates of nhlSampleDays(season, stepDays)) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dates}`;
    await parseScoreboard(url, season, games, userAgent);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  for (let week = 1; week <= maxWeek; week++) {
    const wurl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${season}&seasontype=2&week=${week}`;
    await parseScoreboard(wurl, season, games, userAgent);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  const ordered = Array.from(new Map(games.map((g) => [g.eventId, g])).values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(ordered), "utf8");
    console.log(`nhl-cache write ${cacheKey} n=${ordered.length}`);
  } catch {
    /* non-fatal */
  }
  return ordered;
}

export async function fetchBoxPlayers(
  eventId: string,
  userAgent = "stadium-sim-v2-nhl",
): Promise<BoxPlayer[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${eventId}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (!r.ok) return [];
    const j = (await r.json()) as {
      boxscore?: {
        players?: Array<{
          team?: { id?: string };
          statistics?: Array<{
            athletes?: Array<{
              athlete?: { id?: string };
              stats?: string[];
            }>;
            names?: string[];
            keys?: string[];
          }>;
        }>;
      };
      header?: {
        competitions?: Array<{
          competitors?: Array<{ homeAway?: string; team?: { id?: string } }>;
        }>;
      };
    };
    const comps = j.header?.competitions?.[0]?.competitors ?? [];
    const homeTid = comps.find((c) => c.homeAway === "home")?.team?.id;
    const awayTid = comps.find((c) => c.homeAway === "away")?.team?.id;
    const out: BoxPlayer[] = [];
    for (const block of j.boxscore?.players ?? []) {
      const tid = block.team?.id;
      const side: "home" | "away" | null =
        tid && tid === homeTid ? "home" : tid && tid === awayTid ? "away" : null;
      if (!side) continue;
      for (const grp of block.statistics ?? []) {
        const keys = grp.keys ?? grp.names ?? [];
        const idx = boxStatIndices(keys);
        for (const a of grp.athletes ?? []) {
          const id = a.athlete?.id;
          if (!id || typeof id !== "string" || !id.trim() || !a.stats?.length) continue;
          const goals = idx.goals >= 0 ? Number(a.stats[idx.goals] ?? 0) : 0;
          const sog = idx.sog >= 0 ? Number(a.stats[idx.sog] ?? 0) : 0;
          const saves = idx.saves >= 0 ? Number(a.stats[idx.saves] ?? 0) : 0;
          const toiSeconds =
            idx.toi >= 0 ? parseToiSeconds(a.stats[idx.toi]) : null;
          if (!Number.isFinite(goals) && !Number.isFinite(sog) && !Number.isFinite(saves)) {
            continue;
          }
          out.push({
            athleteId: id.trim(),
            teamSide: side,
            goals: Number.isFinite(goals) ? goals : 0,
            sog: Number.isFinite(sog) ? sog : 0,
            saves: Number.isFinite(saves) ? saves : 0,
            isGoalie: idx.isGoalieGrp || saves > 0,
            toiSeconds,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function teamForm(teamId: string, before: number, games: NhlGame[]) {
  const prior = games.filter(
    (g) =>
      new Date(g.kickoffIso).getTime() < before &&
      (g.homeId === teamId || g.awayId === teamId),
  );
  if (prior.length < 4) return null;
  const used = prior.slice(-8);
  let gf = 0;
  let ga = 0;
  const recent: number[] = [];
  for (const g of used) {
    if (g.homeId === teamId) {
      gf += g.homeReg;
      ga += g.awayReg;
      recent.push(g.homeReg);
    } else {
      gf += g.awayReg;
      ga += g.homeReg;
      recent.push(g.awayReg);
    }
  }
  return {
    teamId,
    goalsFor: gf / used.length,
    goalsAgainst: ga / used.length,
    recentFgGoals: recent,
  };
}

/** Chronological 55/20/25 within a season list (never tune on holdout). */
export function chronoSplit<T>(rows: T[]): { train: T[]; val: T[]; holdout: T[] } {
  const n = rows.length;
  const tEnd = Math.floor(n * 0.55);
  const vEnd = Math.floor(n * 0.75);
  return {
    train: rows.slice(0, tEnd),
    val: rows.slice(tEnd, vEnd),
    holdout: rows.slice(vEnd),
  };
}
