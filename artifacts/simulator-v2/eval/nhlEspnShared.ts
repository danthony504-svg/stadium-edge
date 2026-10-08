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
  assists: number;
  /** goals + assists when ESPN omits a points column (typical). */
  points: number;
  sog: number;
  saves: number;
  /** Plus/minus when present; null if column missing. */
  plusMinus: number | null;
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

export type NhlBoxStatIndices = {
  goals: number;
  assists: number;
  points: number;
  sog: number;
  saves: number;
  plusMinus: number;
  toi: number;
  isGoalieGrp: boolean;
  /** Whether columns look like ESPN machine keys vs display labels. */
  columnMode: "keys" | "labels" | "mixed";
};

/**
 * ESPN NHL boxscore machine keys vs display labels (site API):
 * - SOG actuals → key `shotsTotal` (label `S`). Label `SOG` is **shootoutGoals**.
 * - Assists → key `assists` (label `A`).
 * - Points → usually absent; derive goals+assists.
 * - Saves → key `saves` (label `SV`); never `shootoutSaves` / `evenStrengthSaves`.
 * - Plus/minus → key `plusMinus` (label `+/-`).
 * - Goalie groups expose `goalsAgainst` (not skater `goals`) + `saves`.
 */
export function detectNhlBoxColumnMode(cols: string[]): "keys" | "labels" | "mixed" {
  const keyHits = cols.filter((k) =>
    /^(shotsTotal|timeOnIce|plusMinus|assists|goalsAgainst|shotsAgainst|ytdGoals|blockedShots)$/i.test(
      k,
    ),
  ).length;
  const labelHits = cols.filter((k) =>
    /^(TOI|SV|SV%|GA|SA|\+\/-|YTDG|BS|HT|PPTOI)$/i.test(k),
  ).length;
  if (keyHits > 0 && labelHits === 0) return "keys";
  if (labelHits > 0 && keyHits === 0) return "labels";
  if (keyHits > 0 && labelHits > 0) return "mixed";
  // Ambiguous short tokens (G/A/S) — treat as labels so `SOG`≠shots.
  return "labels";
}

/**
 * Map ESPN boxscore column keys/labels → goals / assists / points / SOG / saves / ± / TOI.
 * Critical: skater SOG is `shotsTotal` (or label `S`), never label `SOG` (shootout goals).
 */
export function boxStatIndices(keys: string[]): NhlBoxStatIndices {
  const mode = detectNhlBoxColumnMode(keys);
  const find = (re: RegExp) => keys.findIndex((k) => re.test(k));

  let goals: number;
  let assists: number;
  let points: number;
  let sog: number;
  let saves: number;
  let plusMinus: number;
  let toi: number;

  if (mode === "keys" || mode === "mixed") {
    // Machine keys — strict anchors (avoid goalsAgainst / shootoutSaves / shootoutGoals).
    goals = find(/^(goals)$/i);
    assists = find(/^(assists)$/i);
    points = find(/^(points)$/i);
    // Prefer shotsTotal; allow sog/shotsOnGoal; never shootoutGoals / shotsMissed / shotsAgainst.
    sog = find(/^(shotsTotal|shotsOnGoal|sog)$/i);
    if (sog < 0) sog = find(/^(shots)$/i);
    saves = find(/^(saves)$/i);
    plusMinus = find(/^(plusMinus|plus_minus)$/i);
    toi = find(/^(timeOnIce|toi)$/i);
  } else {
    // Display labels — ESPN uses S for shots, SOG for shootout goals.
    goals = find(/^(g)$/i);
    assists = find(/^(a|ast)$/i);
    points = find(/^(pts|p)$/i);
    sog = find(/^(s)$/i); // NOT /^sog$/ — that is shootoutGoals
    saves = find(/^(sv)$/i);
    plusMinus = find(/^(\+\/-|pm)$/i);
    toi = find(/^(toi)$/i);
  }

  // Goalie grp: has saves, no skater goals column (goalsAgainst ≠ goals).
  const isGoalieGrp = saves >= 0 && goals < 0;
  return { goals, assists, points, sog, saves, plusMinus, toi, isGoalieGrp, columnMode: mode };
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
            /** Display labels (G/A/S/SV). Prefer `keys` — label SOG is shootoutGoals. */
            labels?: string[];
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
        // Prefer machine keys; labels alone mis-map SOG→shootoutGoals.
        const keys = grp.keys?.length
          ? grp.keys
          : (grp.labels?.length ? grp.labels : (grp.names ?? []));
        const idx = boxStatIndices(keys);
        for (const a of grp.athletes ?? []) {
          const id = a.athlete?.id;
          if (!id || typeof id !== "string" || !id.trim() || !a.stats?.length) continue;
          const goals = idx.goals >= 0 ? Number(a.stats[idx.goals] ?? 0) : 0;
          const assists = idx.assists >= 0 ? Number(a.stats[idx.assists] ?? 0) : 0;
          const sog = idx.sog >= 0 ? Number(a.stats[idx.sog] ?? 0) : 0;
          const saves = idx.saves >= 0 ? Number(a.stats[idx.saves] ?? 0) : 0;
          const plusRaw =
            idx.plusMinus >= 0 ? Number(a.stats[idx.plusMinus] ?? NaN) : NaN;
          const ptsRaw = idx.points >= 0 ? Number(a.stats[idx.points] ?? NaN) : NaN;
          const g = Number.isFinite(goals) ? goals : 0;
          const ast = Number.isFinite(assists) ? assists : 0;
          const points = Number.isFinite(ptsRaw) ? ptsRaw : g + ast;
          const toiSeconds =
            idx.toi >= 0 ? parseToiSeconds(a.stats[idx.toi]) : null;
          if (
            !Number.isFinite(g) &&
            !Number.isFinite(ast) &&
            !Number.isFinite(sog) &&
            !Number.isFinite(saves)
          ) {
            continue;
          }
          out.push({
            athleteId: id.trim(),
            teamSide: side,
            goals: g,
            assists: ast,
            points,
            sog: Number.isFinite(sog) ? sog : 0,
            saves: Number.isFinite(saves) ? saves : 0,
            plusMinus: Number.isFinite(plusRaw) ? plusRaw : null,
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
