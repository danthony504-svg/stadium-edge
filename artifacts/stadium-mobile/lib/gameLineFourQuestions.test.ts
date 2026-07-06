import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTeamFourQuestions,
  buildGameFourQuestions,
  fourQuestionsNoteForPick,
  realOddsToGameLines,
} from "./gameLineFourQuestions.ts";

const sim = {
  sport: "mlb",
  simulations: 10_000,
  homeWinProbability: 0.58,
  awayWinProbability: 0.42,
  tieProbability: 0,
  homeProjectedScore: 5.2,
  awayProjectedScore: 4.1,
  mostLikelyWinner: "home" as const,
  mostLikelyWinnerPct: 0.58,
  confidenceScore: 60,
  coverHitRates: {
    "away @ home|moneyline|home ml": 0.58,
    "away @ home|moneyline|away ml": 0.42,
    "away @ home|spread|home -1.5": 0.54,
    "away @ home|spread|away +1.5": 0.46,
  },
};

test("buildTeamFourQuestions answers all four questions", () => {
  const fq = buildTeamFourQuestions({
    gameLabel: "Away @ Home",
    team: "Home",
    teamSide: "home",
    sim,
    oddsLines: [
      { market: "Moneyline", pick: "Home ML", odds: -130, edge: 2.1 },
      { market: "Spread", pick: "Home -1.5", odds: -110, edge: 1.4 },
    ],
  });
  assert.equal(fq.questions.length, 4);
  assert.equal(fq.questions[0]!.question, "Does the team win?");
  assert.equal(fq.questions[0]!.answer, "58%");
  assert.match(fq.questions[1]!.answer, /Cover -1\.5: 54%/);
  assert.equal(fq.questions[2]!.answer, "54%");
  assert.equal(fq.questions[3]!.answer, "Yes");
});

test("buildGameFourQuestions returns home and away", () => {
  const rows = buildGameFourQuestions({
    gameLabel: "Away @ Home",
    homeTeam: "Home",
    awayTeam: "Away",
    sim,
    oddsLines: [
      { market: "Moneyline", pick: "Home ML", odds: -130, edge: 2.1 },
      { market: "Moneyline", pick: "Away ML", odds: 110, edge: null },
      { market: "Spread", pick: "Home -1.5", odds: -110, edge: 1.4 },
      { market: "Spread", pick: "Away +1.5", odds: -110, edge: null },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.team, "Home");
});

test("buildTeamFourQuestions resolves alt spread cover from sim", () => {
  const fq = buildTeamFourQuestions({
    gameLabel: "Philadelphia Phillies @ Kansas City Royals",
    team: "Philadelphia Phillies",
    teamSide: "away",
    sim: {
      sport: "mlb",
      simulations: 10_000,
      homeWinProbability: 0.499,
      awayWinProbability: 0.501,
      homeProjectedScore: 4.49,
      awayProjectedScore: 4.5,
      tieProbability: 0,
      mostLikelyWinner: "away" as const,
      mostLikelyWinnerPct: 0.501,
      confidenceScore: 50,
      coverHitRates: {
        "philadelphia phillies @ kansas city royals|spread|philadelphia phillies +1.5": 0.61,
      },
    },
    oddsLines: [
      { market: "Spread", pick: "Philadelphia Phillies +1.5", odds: -145, edge: 2.4, noVigFair: 0.613 },
      { market: "Alt Spread", pick: "Philadelphia Phillies +2.5", odds: -700, edge: null },
    ],
  });
  assert.match(fq.questions[1]!.answer, /Cover \+1\.5: 61%/);
  assert.match(fq.questions[3]!.detail ?? "", /Fair odds/);
  assert.match(fq.questions[3]!.detail ?? "", /Sportsbook: -145/);
  assert.match(fq.questions[3]!.detail ?? "", /Edge: \+2\.4%/);
});

test("realOddsToGameLines matches odds labels when ESPN and API names differ", () => {
  const lines = realOddsToGameLines(
    [
      {
        sport: "mlb",
        game: "Philadelphia Phillies @ Kansas City Royals",
        market: "Spread",
        pick: "Philadelphia Phillies +1.5",
        odds: -145,
        edge: 2.4,
      },
    ],
    "Phillies @ Royals",
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.pick, "Philadelphia Phillies +1.5");
});

test("fourQuestionsNoteForPick formats coach note", () => {
  const note = fourQuestionsNoteForPick(
    { game: "Away @ Home", market: "Spread", pick: "Home -1.5", odds: -110 },
    sim,
    [
      {
        sport: "mlb",
        game: "Away @ Home",
        market: "Spread",
        pick: "Home -1.5",
        odds: -110,
        edge: 1.4,
      },
    ],
  );
  assert.match(note, /Does the team win\?/);
  assert.match(note, /Do they cover\?/);
  assert.match(note, /Is the price worth it\?/);
});
