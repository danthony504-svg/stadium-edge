// Game-line bet analysis framed as four questions — not just "who wins?"
// 1. Does the team win?
// 2. Do they cover?
// 3. How often do they cover?
// 4. Is the price worth it?

import type { RealOddsEntry } from "./api.ts";
import {
  GAME_SIM_MIN_HIT,
  buildGameCoverQuery,
  gamePickCoverQueryId,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";

export type GameOddsLine = {
  market: string;
  pick: string;
  odds: number;
  edge?: number | null;
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
  return `${Math.round(n * 100)}%`;
}

function hitFromRates(
  gameLabel: string,
  market: string,
  pick: string,
  rates?: Record<string, number>,
): number | null {
  const id = gamePickCoverQueryId({
    game: gameLabel,
    market,
    pick,
    odds: 0,
    isProp: false,
  });
  if (!id || !rates) return null;
  const hit = rates[id];
  return hit != null && Number.isFinite(hit) ? hit : null;
}

function oddsLineForTeam(
  lines: GameOddsLine[],
  gameLabel: string,
  team: string,
  market: string,
): GameOddsLine | null {
  const fam = market.toLowerCase();
  return (
    lines.find(
      (l) =>
        l.market.toLowerCase().includes(fam) &&
        l.pick.toLowerCase().startsWith(team.toLowerCase()),
    ) ?? null
  );
}

function priceWorthItAnswer(edge: number | null | undefined, odds: number | null): FourQuestionAnswer {
  if (edge == null || !Number.isFinite(edge)) {
    return { question: PRICE_Q, answer: "Unknown", detail: "No posted line to score" };
  }
  const oddsStr = odds != null ? ` at ${odds > 0 ? `+${odds}` : odds}` : "";
  if (edge >= 1) {
    return {
      question: PRICE_Q,
      answer: "Yes",
      detail: `+${edge}% no-vig edge${oddsStr}`,
    };
  }
  if (edge > 0) {
    return {
      question: PRICE_Q,
      answer: "Slight edge",
      detail: `+${edge}% edge${oddsStr}`,
    };
  }
  if (edge > -1) {
    return { question: PRICE_Q, answer: "Fair", detail: `~market price${oddsStr}` };
  }
  return {
    question: PRICE_Q,
    answer: "No",
    detail: `${edge}% edge — price looks rich${oddsStr}`,
  };
}

function winAnswer(hit: number | null): FourQuestionAnswer {
  if (hit == null) {
    return { question: WIN_Q, answer: "Unknown", detail: "No sim data" };
  }
  const p = pct(hit)!;
  if (hit >= GAME_SIM_MIN_HIT) {
    return { question: WIN_Q, answer: "Yes", detail: `Wins in ${p} of 10,000 sims` };
  }
  if (hit <= 1 - GAME_SIM_MIN_HIT) {
    return { question: WIN_Q, answer: "No", detail: `Wins in only ${p} of 10,000 sims` };
  }
  return { question: WIN_Q, answer: "Toss-up", detail: `Wins in ${p} of 10,000 sims` };
}

function coverAnswer(hit: number | null, spreadPick: string | null): FourQuestionAnswer {
  if (spreadPick == null) {
    return { question: COVER_Q, answer: "—", detail: "No spread line posted" };
  }
  if (hit == null) {
    return { question: COVER_Q, answer: "Unknown", detail: spreadPick };
  }
  const p = pct(hit)!;
  if (hit >= GAME_SIM_MIN_HIT) {
    return { question: COVER_Q, answer: "Yes", detail: `${spreadPick} clears in ${p} of sims` };
  }
  return { question: COVER_Q, answer: "No", detail: `${spreadPick} clears in only ${p} of sims` };
}

function coverRateAnswer(hit: number | null, spreadPick: string | null): FourQuestionAnswer {
  if (spreadPick == null) {
    return { question: RATE_Q, answer: "—", detail: "No spread line posted" };
  }
  if (hit == null) {
    return { question: RATE_Q, answer: "Unknown", detail: spreadPick };
  }
  return { question: RATE_Q, answer: pct(hit)!, detail: `${spreadPick} across 10,000 sims` };
}

/** Build the four-question breakdown for one team from shared sim + real odds. */
export function buildTeamFourQuestions(input: {
  gameLabel: string;
  team: string;
  teamSide: "home" | "away";
  sim?: CoachGameSimEntry | null;
  oddsLines?: GameOddsLine[];
}): TeamFourQuestions {
  const rates = input.sim?.coverHitRates;
  const mlLine = oddsLineForTeam(input.oddsLines ?? [], input.gameLabel, input.team, "moneyline");
  const spreadLine = oddsLineForTeam(input.oddsLines ?? [], input.gameLabel, input.team, "spread");

  const mlPick = mlLine?.pick ?? `${input.team} ML`;
  const mlHit =
    hitFromRates(input.gameLabel, "Moneyline", mlPick, rates) ??
    (input.teamSide === "home"
      ? input.sim?.homeWinProbability ?? null
      : input.sim?.awayWinProbability ?? null);

  const spreadPick = spreadLine?.pick ?? null;
  const spreadHit = spreadPick
    ? hitFromRates(input.gameLabel, "Spread", spreadPick, rates)
    : null;

  const edgePct = spreadLine?.edge ?? mlLine?.edge ?? null;
  const priceOdds = spreadLine?.odds ?? mlLine?.odds ?? null;

  return {
    team: input.team,
    teamSide: input.teamSide,
    mlHitPct: mlHit,
    spreadHitPct: spreadHit,
    spreadPick,
    edgePct: edgePct ?? null,
    questions: [
      winAnswer(mlHit),
      coverAnswer(spreadHit, spreadPick),
      coverRateAnswer(spreadHit, spreadPick),
      priceWorthItAnswer(edgePct, priceOdds),
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
