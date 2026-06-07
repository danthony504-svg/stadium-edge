import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson, rateLimit } from "../lib/sports";
import { playerPeriodGameLog, soccerPlayerGameLog } from "../lib/statmuse";

// Grades FINISHED bet legs against REAL outcomes so the app can keep an honest
// win/loss ledger (and, downstream, tell the user which bet TYPES the model is
// actually good at). Every result is derived from a real final score or a real
// stat-log value — when we can't confidently settle a leg we return
// "ungraded" and it is excluded from the user's record. We NEVER guess a W/L.

const router: IRouter = Router();

router.use("/sports/grade", rateLimit({ windowMs: 60_000, max: 60, name: "grade" }));

type FinalGame = {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  startsAt: string;
  state: string | null;
};

type EspnScoreEvent = {
  id: string;
  date: string;
  status?: { type?: { state?: string } };
  competitions?: Array<{
    status?: { type?: { state?: string } };
    competitors?: Array<{
      homeAway: "home" | "away";
      score?: string;
      team?: { displayName?: string };
    }>;
  }>;
};

// Pull recent FINAL games for a sport from ESPN's scoreboard (yesterday → +7d,
// same window as /sports/games so a just-finished game is present). Only
// completed games (state === "post") with both numeric scores are returned.
async function fetchFinals(sportPath: string): Promise<FinalGame[]> {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const now = new Date();
  const start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dateRange = `${fmt(start)}-${fmt(end)}`;
  const data = await cachedJson<{ events?: EspnScoreEvent[] }>(
    `grade-finals:${sportPath}:${dateRange}`,
    60 * 1000,
    async () => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateRange}&limit=200`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN ${r.status}`);
      return (await r.json()) as { events?: EspnScoreEvent[] };
    },
  );
  const out: FinalGame[] = [];
  for (const e of data.events ?? []) {
    const comp = e.competitions?.[0];
    const state = comp?.status?.type?.state ?? e.status?.type?.state ?? null;
    if (state !== "post") continue;
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    const hs = home?.score != null ? parseInt(home.score, 10) : NaN;
    const as = away?.score != null ? parseInt(away.score, 10) : NaN;
    if (!home?.team?.displayName || !away?.team?.displayName) continue;
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    out.push({
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeScore: hs,
      awayScore: as,
      startsAt: e.date,
      state,
    });
  }
  return out;
}

const lastToken = (s: string) => s.toLowerCase().trim().split(/\s+/).slice(-1)[0] ?? "";

// Does this pick/matchup text name the given team? Match the full display name
// or its nickname (last token, e.g. "Lakers" from "Los Angeles Lakers").
function namesTeam(text: string, team: string): boolean {
  const t = text.toLowerCase();
  const nick = lastToken(team);
  return t.includes(team.toLowerCase()) || (nick.length >= 3 && t.includes(nick));
}

// Find the finished game a leg's matchup string refers to. Same two teams can
// appear several times in the window (a series / doubleheader), so:
//  - if the leg carries the game's start time, lock onto the final within ±1
//    day of it (closest wins) — exact, never guesses across games;
//  - otherwise fall back to the MOST RECENT matching final. Grading runs the
//    moment a slip's game ends, so the just-finished game is the latest one.
// Returns null when no team-matched final exists at all.
function matchFinal(legGame: string, finals: FinalGame[], startsAt?: string): FinalGame | null {
  const hits = finals.filter(
    (g) => namesTeam(legGame, g.homeTeam) && namesTeam(legGame, g.awayTeam),
  );
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const wantMs = startsAt ? Date.parse(startsAt) : NaN;
  if (Number.isFinite(wantMs)) {
    const dated = hits
      .map((g) => ({ g, diff: Math.abs(Date.parse(g.startsAt) - wantMs) }))
      .filter((x) => Number.isFinite(x.diff) && x.diff <= 36 * 60 * 60 * 1000)
      .sort((a, b) => a.diff - b.diff);
    if (dated.length > 0) return dated[0].g;
    return null; // a start time was given but no final lines up → don't guess
  }
  // No start time: take the most recent matching final.
  return hits.slice().sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
}

type GradeResult = "win" | "loss" | "push" | "ungraded";

// StatMuse rows carry "M/D/YYYY"; ESPN start dates are ISO. Settle a prop only
// against the row whose date matches the finished game's date (±1 day to absorb
// UTC/local skew), so we never grade a leg against a different game.
function dayOf(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}
function parseStatMuseDay(s: string): number | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return Math.floor(Date.UTC(yr, Number(m[1]) - 1, Number(m[2])) / 86_400_000);
}

// Map a prop market/stat label to the soccer game-log column key.
function soccerStatKey(stat: string): string | null {
  const s = stat.toLowerCase();
  if (/shots?\s+on\s+target/.test(s)) return "SOT";
  if (/goal/.test(s)) return "G";
  if (/assist/.test(s)) return "A";
  if (/shot/.test(s)) return "SH";
  return null;
}

// Settle a numeric over/under player prop against the player's real game log.
async function gradeProp(
  player: string,
  side: "over" | "under",
  line: number,
  stat: string,
  sport: string,
  gameDay: number | null,
): Promise<{ result: GradeResult; detail: string }> {
  let value: number | null = null;
  if (sport === "soccer") {
    const key = soccerStatKey(stat);
    if (!key) return { result: "ungraded", detail: "unsupported soccer stat" };
    const rows = await soccerPlayerGameLog(player);
    if (!rows || rows.length === 0) return { result: "ungraded", detail: "no game log" };
    const row =
      gameDay !== null
        ? rows.find((r) => {
            const d = parseStatMuseDay(r.date);
            return d !== null && Math.abs(d - gameDay) <= 1;
          })
        : null;
    const raw = row?.stats?.[key];
    if (raw == null) return { result: "ungraded", detail: "no matching game" };
    value = parseFloat(raw);
  } else {
    const log = await playerPeriodGameLog(player, "", stat, sport, 10);
    if (!log || log.rows.length === 0) return { result: "ungraded", detail: "no game log" };
    const row =
      gameDay !== null
        ? log.rows.find((r) => {
            const d = parseStatMuseDay(r.date);
            return d !== null && Math.abs(d - gameDay) <= 1;
          })
        : null;
    if (!row) return { result: "ungraded", detail: "no matching game" };
    value = parseFloat(row.value);
  }
  if (value === null || !Number.isFinite(value)) {
    return { result: "ungraded", detail: "no stat value" };
  }
  if (value === line) return { result: "push", detail: `${value} = ${line}` };
  const over = value > line;
  const win = side === "over" ? over : !over;
  return { result: win ? "win" : "loss", detail: `${value} ${side} ${line}` };
}

type GradeLeg = { game?: string; market?: string; pick?: string; sport?: string; odds?: number; startsAt?: string };

router.post("/sports/grade", async (req, res): Promise<void> => {
  const legs: GradeLeg[] = Array.isArray(req.body?.legs) ? req.body.legs : [];
  if (legs.length === 0 || legs.length > 30) {
    res.status(400).json({ error: "legs must be a 1..30 array" });
    return;
  }

  // Fetch finals once per distinct sport.
  const sports = Array.from(new Set(legs.map((l) => (l.sport || "").toLowerCase()).filter(Boolean)));
  const finalsBySport = new Map<string, FinalGame[]>();
  await Promise.all(
    sports.map(async (sp) => {
      const path = ESPN_SPORT_PATHS[sp];
      if (!path) return;
      try {
        finalsBySport.set(sp, await fetchFinals(path));
      } catch {
        /* leave unset → those legs grade ungraded */
      }
    }),
  );

  const results = await Promise.all(
    legs.map(async (leg, index) => {
      const sport = (leg.sport || "").toLowerCase();
      const game = String(leg.game || "");
      const market = String(leg.market || "");
      const pick = String(leg.pick || "").trim();
      const base = { index, family: "", side: "" as string };
      const finals = finalsBySport.get(sport);
      if (!finals) return { ...base, result: "ungraded" as GradeResult, detail: "no scores for sport" };
      const final = matchFinal(game, finals, leg.startsAt);
      if (!final) return { ...base, result: "ungraded" as GradeResult, detail: "game not final / not found" };

      const total = final.homeScore + final.awayScore;

      // --- Player prop: "<Player> Over/Under <line> <stat>" ---
      const propM = pick.match(/^(.+?)\s+(over|under)\s+([\d.]+)\s+(.+)$/i);
      if (propM) {
        const player = propM[1].trim();
        const side = propM[2].toLowerCase() as "over" | "under";
        const line = parseFloat(propM[3]);
        const statText = (market || propM[4]).trim();
        // Combos (PRA etc.) and yes/no markets aren't reliably gradeable here.
        if (/\+|points\s+rebounds|\bpra\b|double[- ]double/i.test(statText)) {
          return { ...base, family: statText.toLowerCase(), side, result: "ungraded" as GradeResult, detail: "combo market" };
        }
        const { result, detail } = await gradeProp(
          player,
          side,
          line,
          statText,
          sport,
          dayOf(new Date(final.startsAt)),
        );
        return { ...base, family: statText.toLowerCase(), side, result, detail };
      }

      // --- Game total: "Over/Under <line>" ---
      const totM = pick.match(/^(over|under)\s+([\d.]+)/i);
      if (totM) {
        const side = totM[1].toLowerCase();
        const line = parseFloat(totM[2]);
        if (total === line) return { ...base, family: "total", side, result: "push" as GradeResult, detail: `${total} = ${line}` };
        const over = total > line;
        const win = side === "over" ? over : !over;
        return { ...base, family: "total", side, result: (win ? "win" : "loss") as GradeResult, detail: `${total} vs ${line}` };
      }

      // Resolve which team the pick names (needed for ML + spread).
      const picksHome = namesTeam(pick, final.homeTeam);
      const picksAway = namesTeam(pick, final.awayTeam);
      if (picksHome === picksAway) {
        // names both or neither team → can't settle safely
        return { ...base, result: "ungraded" as GradeResult, detail: "team unresolved" };
      }
      const pickedScore = picksHome ? final.homeScore : final.awayScore;
      const oppScore = picksHome ? final.awayScore : final.homeScore;
      const sideLabel = picksHome ? "home" : "away";

      // --- Spread: "<Team> -5.5" / "<Team> +3.5" ---
      const spM = pick.match(/([+-]\s*\d+(?:\.\d+)?)/);
      if (spM && /spread|run\s*line|puck\s*line|handicap|[+-]\s*\d/i.test(market + " " + pick)) {
        const lineNum = parseFloat(spM[1].replace(/\s+/g, ""));
        const adj = pickedScore - oppScore + lineNum;
        if (adj === 0) return { ...base, family: "spread", side: sideLabel, result: "push" as GradeResult, detail: `cover by ${adj}` };
        return { ...base, family: "spread", side: sideLabel, result: (adj > 0 ? "win" : "loss") as GradeResult, detail: `margin ${pickedScore - oppScore}, line ${lineNum}` };
      }

      // --- Moneyline: bare team name ---
      // Soccer is a 3-way market: a draw is its own outcome, so a TEAM moneyline
      // (not "draw"/DNB — those name no team and already fall out as ungraded
      // above) LOSES on a tie. Other sports settle ties as push (regulation ties
      // are effectively impossible in their finals, so this is just a safe guard).
      if (pickedScore === oppScore) {
        if (sport === "soccer")
          return { ...base, family: "moneyline", side: sideLabel, result: "loss" as GradeResult, detail: `draw ${pickedScore}-${oppScore}` };
        return { ...base, family: "moneyline", side: sideLabel, result: "push" as GradeResult, detail: "tie" };
      }
      return { ...base, family: "moneyline", side: sideLabel, result: (pickedScore > oppScore ? "win" : "loss") as GradeResult, detail: `${pickedScore}-${oppScore}` };
    }),
  );

  res.json({ results });
});

export default router;
