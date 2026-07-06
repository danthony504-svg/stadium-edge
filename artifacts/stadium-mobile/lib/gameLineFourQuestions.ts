// Game-line bet analysis framed as four questions — not just "who wins?"
// 1. Does the team win?
// 2. Do they cover?
// 3. How often do they cover?
// 4. Is the price worth it?

import type { RealOddsEntry } from "./api.ts";
import {
  GAME_SIM_MIN_HIT,
  buildGameCoverQuery,
  gameSimHitForPick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { fairOddsFromProb } from "./gameSimQualityGates.ts";
import { formatAmerican } from "./format.ts";

export type GameOddsLine = {
  market: string;
  pick: string;
  odds: number;
  edge?: number | null;
  noVigFair?: number | null;
};

export type FourQuestionAnswer = {
  question: string;
  answer: string;
  detail?: string;
};

export type TeamFourQuestions = {
  team: string;
  teamSide: "home" | "away";
  questions: FourQuestionAnswer[];
  mlHitPct: number | null;
  spreadHitPct: number | null;
  spreadPick: string | null;
  edgePct: number | null;
};

const WIN_Q = "Does the team win?";
const COVER_Q = "Do they cover?";
const RATE_Q = "How often do they cover?";
const PRICE_Q = "Is the price worth it?";

function pct(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${(n * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

const normTeam = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamMatchesPick(team: string, pick: string): boolean {
  const t = normTeam(team);
  const p = normTeam(pick);
  if (!t || !p) return false;
  if (p.startsWith(t) || t.startsWith(p)) return true;
  const nick = (s: string) => {
    const parts = normTeam(s).split(" ").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  };
  const tn = nick(team);
  const pn = nick(pick);
  if (tn.length > 2 && (p.includes(tn) || pn === tn)) return true;
  const tokens = t.split(" ").filter((w) => w.length > 2);
  return tokens.some((w) => p.includes(w));
}

function spreadPoints(pick: string): number | null {
  const m = String(pick).match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function spreadLinesForTeam(lines: GameOddsLine[], team: string): GameOddsLine[] {
  return lines.filter(
    (l) => /spread/i.test(l.market) && teamMatchesPick(team, l.pick),
  );
}

/** Prefer main spread at ±1.5; fall back to closest standard rung. */
function bestSpreadLineForTeam(lines: GameOddsLine[], team: string): GameOddsLine | null {
  const candidates = spreadLinesForTeam(lines, team);
  if (!candidates.length) return null;
  const main = candidates.filter((l) => /^spread$/i.test(l.market.trim()));
  const pool = main.length ? main : candidates;
  return pool.sort((a, b) => {
    const da = Math.abs(Math.abs(spreadPoints(a.pick) ?? 99) - 1.5);
    const db = Math.abs(Math.abs(spreadPoints(b.pick) ?? 99) - 1.5);
    if (da !== db) return da - db;
    return /^spread$/i.test(a.market) ? -1 : 1;
  })[0]!;
}

function oddsLineForTeam(
  lines: GameOddsLine[],
  team: string,
  market: string,
): GameOddsLine | null {
  const fam = market.toLowerCase();
  if (fam.includes("spread")) return bestSpreadLineForTeam(lines, team);
  return (
    lines.find(
      (l) =>
        l.market.toLowerCase().includes(fam) && teamMatchesPick(team, l.pick),
    ) ?? null
  );
}

function simHitForLine(
  gameLabel: string,
  line: GameOddsLine | null,
  sim?: CoachGameSimEntry | null,
): number | null {
  if (!line || !sim) return null;
  return gameSimHitForPick(
    {
      game: gameLabel,
      market: line.market,
      pick: line.pick,
      odds: line.odds,
      isProp: false,
    },
    sim,
  );
}

function priceWorthItAnswer(
  edge: number | null | undefined,
  odds: number | null,
  fairProb: number | null | undefined,
): FourQuestionAnswer {
  if (odds == null && edge == null) {
    return { question: PRICE_Q, answer: "Unknown", detail: "No posted line to score" };
  }
  const fair = fairOddsFromProb(fairProb);
  const parts: string[] = [];
  if (fair != null) parts.push(`Fair odds: ${formatAmerican(fair)}`);
  if (odds != null) parts.push(`Sportsbook: ${formatAmerican(odds)}`);
  if (edge != null && Number.isFinite(edge)) {
    parts.push(`Edge: ${edge > 0 ? "+" : ""}${edge}%`);
  }
  const detail = parts.length ? parts.join(" · ") : "No posted line to score";
  if (edge == null || !Number.isFinite(edge)) {
    return { question: PRICE_Q, answer: "Unknown", detail };
  }
  if (edge >= 1) return { question: PRICE_Q, answer: "Yes", detail };
  if (edge > 0) return { question: PRICE_Q, answer: "Slight edge", detail };
  if (edge > -1) return { question: PRICE_Q, answer: "Fair", detail };
  return { question: PRICE_Q, answer: "No", detail };
}

function winAnswer(hit: number | null, simCount: number): FourQuestionAnswer {
  if (hit == null) {
    return { question: WIN_Q, answer: "Unknown", detail: "No sim data" };
  }
  const p = pct(hit)!;
  const clears = Math.round(hit * simCount);
  const freq = `${clears.toLocaleString()}/${simCount.toLocaleString()} sims`;
  if (hit >= GAME_SIM_MIN_HIT) {
    return { question: WIN_Q, answer: p, detail: `Wins in ${freq}` };
  }
  if (hit <= 1 - GAME_SIM_MIN_HIT) {
    return { question: WIN_Q, answer: p, detail: `Wins in only ${freq}` };
  }
  return { question: WIN_Q, answer: p, detail: `Toss-up — wins in ${freq}` };
}

function coverAnswer(hit: number | null, spreadPick: string | null, simCount: number): FourQuestionAnswer {
  if (spreadPick == null) {
    return { question: COVER_Q, answer: "—", detail: "No spread line posted" };
  }
  if (hit == null) {
    return { question: COVER_Q, answer: "Unknown", detail: spreadPick };
  }
  const p = pct(hit)!;
  const clears = Math.round(hit * simCount);
  if (hit >= GAME_SIM_MIN_HIT) {
    return {
      question: COVER_Q,
      answer: `Cover ${spreadPick.replace(/^.*\s([+-]?\d+(?:\.\d+)?)\s*$/, "$1")}: ${p}`,
      detail: `Clears in ${clears.toLocaleString()}/${simCount.toLocaleString()} sims`,
    };
  }
  return {
    question: COVER_Q,
    answer: `Cover ${spreadPick.replace(/^.*\s([+-]?\d+(?:\.\d+)?)\s*$/, "$1")}: ${p}`,
    detail: `Clears in only ${clears.toLocaleString()}/${simCount.toLocaleString()} sims`,
  };
}

function coverRateAnswer(hit: number | null, spreadPick: string | null, simCount: number): FourQuestionAnswer {
  if (spreadPick == null) {
    return { question: RATE_Q, answer: "—", detail: "No spread line posted" };
  }
  if (hit == null) {
    return { question: RATE_Q, answer: "Unknown", detail: spreadPick };
  }
  const clears = Math.round(hit * simCount);
  return {
    question: RATE_Q,
    answer: pct(hit)!,
    detail: `${clears.toLocaleString()}/${simCount.toLocaleString()} sims on ${spreadPick}`,
  };
}

/** Build the four-question breakdown for one team from shared sim + real odds. */
export function buildTeamFourQuestions(input: {
  gameLabel: string;
  team: string;
  teamSide: "home" | "away";
  sim?: CoachGameSimEntry | null;
  oddsLines?: GameOddsLine[];
}): TeamFourQuestions {
  const simCount = input.sim?.simulations ?? 10_000;
  const mlLine = oddsLineForTeam(input.oddsLines ?? [], input.team, "moneyline");
  const spreadLine = oddsLineForTeam(input.oddsLines ?? [], input.team, "spread");

  const mlPick = mlLine?.pick ?? `${input.team} ML`;
  const mlHit =
    simHitForLine(input.gameLabel, mlLine, input.sim) ??
    (input.teamSide === "home"
      ? input.sim?.homeWinProbability ?? null
      : input.sim?.awayWinProbability ?? null);

  const spreadPick = spreadLine?.pick ?? null;
  const spreadHit = simHitForLine(input.gameLabel, spreadLine, input.sim);

  const priceLine = spreadLine ?? mlLine;
  const edgePct = priceLine?.edge ?? spreadLine?.edge ?? mlLine?.edge ?? null;
  const priceOdds = priceLine?.odds ?? null;
  const fairProb = priceLine?.noVigFair ?? null;

  return {
    team: input.team,
    teamSide: input.teamSide,
    mlHitPct: mlHit,
    spreadHitPct: spreadHit,
    spreadPick,
    edgePct: edgePct ?? null,
    questions: [
      winAnswer(mlHit, simCount),
      coverAnswer(spreadHit, spreadPick, simCount),
      coverRateAnswer(spreadHit, spreadPick, simCount),
      priceWorthItAnswer(edgePct, priceOdds, fairProb),
    ],
  };
}

export function buildGameFourQuestions(input: {
  gameLabel: string;
  homeTeam: string;
  awayTeam: string;
  sim?: CoachGameSimEntry | null;
  oddsLines?: GameOddsLine[];
}): TeamFourQuestions[] {
  return [
    buildTeamFourQuestions({
      gameLabel: input.gameLabel,
      team: input.awayTeam,
      teamSide: "away",
      sim: input.sim,
      oddsLines: input.oddsLines,
    }),
    buildTeamFourQuestions({
      gameLabel: input.gameLabel,
      team: input.homeTeam,
      teamSide: "home",
      sim: input.sim,
      oddsLines: input.oddsLines,
    }),
  ];
}

/** Convert RealOddsEntry rows into cover queries for the shared 10k sim. */
export function coverQueriesFromOddsLines(
  gameLabel: string,
  lines: GameOddsLine[],
  sport?: string,
): ReturnType<typeof buildGameCoverQuery>[] {
  const seen = new Set<string>();
  const out: NonNullable<ReturnType<typeof buildGameCoverQuery>>[] = [];
  for (const l of lines) {
    const q = buildGameCoverQuery({
      game: gameLabel,
      market: l.market,
      pick: l.pick,
      odds: l.odds,
      isProp: false,
      sport,
    });
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

export function realOddsToGameLines(entries: RealOddsEntry[], gameLabel: string): GameOddsLine[] {
  return entries
    .filter((e) => e.game === gameLabel)
    .map((e) => ({
      market: e.market,
      pick: e.pick,
      odds: e.odds,
      edge: e.edge ?? null,
      noVigFair: e.noVigFair ?? null,
    }));
}

/** Markdown note for Coach transparency on a game-line pick. */
export function fourQuestionsNoteForPick(
  pick: { game: string; market: string; pick: string; odds?: number },
  sim: CoachGameSimEntry | null | undefined,
  realOdds?: RealOddsEntry[],
): string {
  const parts = pick.game.split(" @ ");
  if (parts.length !== 2) return "";
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();

  const query = buildGameCoverQuery({
    game: pick.game,
    market: pick.market,
    pick: pick.pick,
    odds: pick.odds ?? 0,
    isProp: false,
  });
  if (!query?.teamSide) return "";

  const teamName = query.teamSide === "home" ? home : away;
  const fq = buildTeamFourQuestions({
    gameLabel: pick.game,
    team: teamName,
    teamSide: query.teamSide,
    sim,
    oddsLines: realOdds ? realOddsToGameLines(realOdds, pick.game) : undefined,
  });

  const lines = fq.questions.map((q) => `• **${q.question}** ${q.answer}${q.detail ? ` — ${q.detail}` : ""}`);
  return `_10k sim check for **${teamName}**:_\n${lines.join("\n")}`;
}
