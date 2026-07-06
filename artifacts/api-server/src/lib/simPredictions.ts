import { asc, eq } from "drizzle-orm";
import { db, simPredictionsTable } from "@workspace/db";
import { ESPN_SPORT_PATHS, cachedJson } from "./sports";
import {
  buildSimPredictionRow,
  gradePredictedWinner,
  type SimPredictionInput,
} from "./simPredictionsCore";

const GIVE_UP_MS = 10 * 24 * 60 * 60 * 1000;

export type { SimPredictionInput } from "./simPredictionsCore";
export { buildSimPredictionRow, edgeBandFromWinProbs, gradePredictedWinner } from "./simPredictionsCore";

type FinalGame = {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  startsAt: string;
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

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  return nick(a).length > 2 && nick(a) === nick(b);
}

/** Upsert a pregame sim prediction (re-runs before tip-off refresh the row). */
export async function persistSimPrediction(input: SimPredictionInput): Promise<void> {
  if (!input.eventId || !input.sport || !input.homeTeam || !input.awayTeam) return;
  const row = buildSimPredictionRow(input);
  await db
    .insert(simPredictionsTable)
    .values(row)
    .onConflictDoUpdate({
      target: simPredictionsTable.id,
      set: {
        homeWinProb: row.homeWinProb,
        awayWinProb: row.awayWinProb,
        predictedWinner: row.predictedWinner,
        predictedTeam: row.predictedTeam,
        edgeBand: row.edgeBand,
        simulations: row.simulations,
        predictedAt: new Date(),
        status: "pending",
        actualWinner: null,
        homeScore: null,
        awayScore: null,
        gradedAt: null,
      },
    });
}

async function fetchFinals(sportPath: string): Promise<FinalGame[]> {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const now = new Date();
  const start = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dateRange = `${fmt(start)}-${fmt(end)}`;
  const data = await cachedJson<{ events?: EspnScoreEvent[] }>(
    `sim-pred-finals:${sportPath}:${dateRange}`,
    60 * 1000,
    async () => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateRange}&limit=300`;
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
    });
  }
  return out;
}

function matchFinal(row: { homeTeam: string; awayTeam: string }, finals: FinalGame[]): FinalGame | null {
  for (const f of finals) {
    if (teamsMatch(row.homeTeam, f.homeTeam) && teamsMatch(row.awayTeam, f.awayTeam)) return f;
    if (teamsMatch(row.homeTeam, f.awayTeam) && teamsMatch(row.awayTeam, f.homeTeam)) return f;
  }
  return null;
}

/** Settle pending predictions against ESPN final scores. */
export async function gradePendingSimPredictions(): Promise<void> {
  const now = Date.now();
  const pending = await db
    .select()
    .from(simPredictionsTable)
    .where(eq(simPredictionsTable.status, "pending"))
    .orderBy(asc(simPredictionsTable.startsAt))
    .limit(50);
  const ready = pending.filter((r) => r.startsAt != null && r.startsAt.getTime() < now);
  if (!ready.length) return;

  const finalsBySport = new Map<string, FinalGame[]>();
  const sports = [...new Set(ready.map((r) => r.sport))];
  await Promise.all(
    sports.map(async (sport) => {
      const path = ESPN_SPORT_PATHS[sport];
      if (!path) return;
      try {
        finalsBySport.set(sport, await fetchFinals(path));
      } catch {
        finalsBySport.set(sport, []);
      }
    }),
  );

  const nowDate = new Date();
  await Promise.all(
    ready.map(async (row) => {
      const finals = finalsBySport.get(row.sport) ?? [];
      const final = matchFinal(row, finals);
      if (!final) {
        if (row.startsAt && now - row.startsAt.getTime() > GIVE_UP_MS) {
          await db
            .update(simPredictionsTable)
            .set({ status: "ungraded", gradedAt: nowDate })
            .where(eq(simPredictionsTable.id, row.id));
        }
        return;
      }
      const { status, actualWinner } = gradePredictedWinner(
        row.predictedWinner,
        final.homeScore,
        final.awayScore,
      );
      await db
        .update(simPredictionsTable)
        .set({
          status,
          actualWinner,
          homeScore: final.homeScore,
          awayScore: final.awayScore,
          gradedAt: nowDate,
        })
        .where(eq(simPredictionsTable.id, row.id));
    }),
  );
}

export type SimPredictionRecord = {
  total: number;
  graded: number;
  correct: number;
  incorrect: number;
  pushes: number;
  pending: number;
  accuracyPct: number | null;
  recommendedGraded: number;
  recommendedCorrect: number;
  recommendedAccuracyPct: number | null;
  byBand: Record<string, { graded: number; correct: number; accuracyPct: number | null }>;
};

const TERMINAL = ["correct", "incorrect", "push"] as const;

export async function getSimPredictionRecord(): Promise<SimPredictionRecord> {
  const rows = await db.select().from(simPredictionsTable);
  const rec: SimPredictionRecord = {
    total: rows.length,
    graded: 0,
    correct: 0,
    incorrect: 0,
    pushes: 0,
    pending: 0,
    accuracyPct: null,
    recommendedGraded: 0,
    recommendedCorrect: 0,
    recommendedAccuracyPct: null,
    byBand: {},
  };

  for (const r of rows) {
    if (r.status === "pending") {
      rec.pending++;
      continue;
    }
    if (!TERMINAL.includes(r.status as (typeof TERMINAL)[number])) continue;

    rec.graded++;
    if (r.status === "correct") rec.correct++;
    else if (r.status === "incorrect") rec.incorrect++;
    else if (r.status === "push") rec.pushes++;

    const band = r.edgeBand ?? "no_edge";
    if (!rec.byBand[band]) rec.byBand[band] = { graded: 0, correct: 0, accuracyPct: null };
    rec.byBand[band].graded++;
    if (r.status === "correct") rec.byBand[band].correct++;

    if (band !== "no_edge") {
      rec.recommendedGraded++;
      if (r.status === "correct") rec.recommendedCorrect++;
    }
  }

  const decided = rec.correct + rec.incorrect;
  if (decided > 0) rec.accuracyPct = Math.round((rec.correct / decided) * 1000) / 10;
  if (rec.recommendedGraded > 0) {
    rec.recommendedAccuracyPct =
      Math.round((rec.recommendedCorrect / rec.recommendedGraded) * 1000) / 10;
  }
  for (const band of Object.keys(rec.byBand)) {
    const b = rec.byBand[band]!;
    if (b.graded > 0) b.accuracyPct = Math.round((b.correct / b.graded) * 1000) / 10;
  }

  return rec;
}

export async function getSimPredictionAccuracySummary(): Promise<string[]> {
  const rec = await getSimPredictionRecord();
  if (rec.graded < 5) return [];
  const lines: string[] = [];
  if (rec.accuracyPct != null) {
    lines.push(
      `Game Simulator winner picks: ${rec.accuracyPct}% (${rec.correct}-${rec.incorrect} on ${rec.graded} graded games)`,
    );
  }
  if (rec.recommendedAccuracyPct != null && rec.recommendedGraded >= 5) {
    lines.push(
      `Recommended sides (55%+ win prob): ${rec.recommendedAccuracyPct}% (${rec.recommendedCorrect}-${rec.recommendedGraded - rec.recommendedCorrect} on ${rec.recommendedGraded})`,
    );
  }
  for (const [band, stats] of Object.entries(rec.byBand)) {
    if (stats.graded < 5 || stats.accuracyPct == null) continue;
    const label =
      band === "strong_edge"
        ? "65%+ band"
        : band === "good_edge"
          ? "60–65% band"
          : band === "small_edge"
            ? "55–60% band"
            : "under 55%";
    lines.push(`${label}: ${stats.accuracyPct}% (${stats.correct}/${stats.graded})`);
  }
  return lines;
}
