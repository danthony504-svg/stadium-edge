import test from "node:test";
import assert from "node:assert/strict";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import { SINGLE_EVENT_CAPS } from "./singleEventSeating.ts";

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
};

function scored(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  rankScore: number,
): BoardScoredLeg {
  return {
    pick: { isProp: false, sport: "nfl", finalAiScore: mainScore, ...pick },
    evPct: 2,
    edgePct: 3,
    confidencePct: 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: "B",
    simHit: 0.55,
    composite: 7,
    rankScore,
  };
}

function rich(sport: string, game: string): BoardScoredLeg[] {
  const players = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9", "J10"];
  const markets =
    sport === "mlb"
      ? ["Hits", "Total Bases", "Home Runs", "Strikeouts", "RBIs", "Runs", "Stolen Bases", "Outs"]
      : sport === "nba" || sport === "wnba"
        ? ["Points", "Rebounds", "Assists", "Threes", "Steals", "Blocks", "Turnovers", "PRA"]
        : sport === "nhl"
          ? ["Points", "Goals", "Assists", "Shots on Goal", "Points", "Goals", "Assists", "Shots on Goal"]
          : sport === "soccer"
            ? ["Shots", "Shots on Target", "Anytime Goal", "Shots", "Shots on Target", "Anytime Goal", "Shots", "Shots on Target"]
            : ["Pass Yds", "Rush Yds", "Rec Yds", "Receptions", "Pass TDs", "Anytime TD", "Rush Attempts", "Sacks"];
  const out: BoardScoredLeg[] = [];
  let r = 200;
  if (sport !== "tennis" && sport !== "ufc") {
    for (let i = 0; i < players.length; i++) {
      const m = markets[i % markets.length]!;
      if (sport === "ncaaf" && m === "Sacks") continue;
      out.push(
        scored(
          {
            game,
            market: m,
            pick: `${players[i]} Over ${10.5 + i}`,
            odds: -110,
            isProp: true,
            player: players[i],
            propLine: 10.5 + i,
            propSide: "Over",
            sport,
          },
          r--,
        ),
      );
    }
    out.push(scored({ game, market: "Moneyline", pick: `${game.split(" @ ")[1]} ML`, odds: -110, sport }, r--));
    out.push(scored({ game, market: "Spread", pick: `${game.split(" @ ")[1]} -3.5`, odds: -110, sport }, r--));
    out.push(scored({ game, market: "Total", pick: "Over 45.5", odds: -110, sport }, r--));
    out.push(scored({ game, market: "Team Total", pick: `${game.split(" @ ")[1]} Over 22.5`, odds: -110, sport }, r--));
    out.push(scored({ game, market: "1H Spread", pick: `${game.split(" @ ")[0]} +2.5`, odds: -110, sport }, r--));
  }
  if (sport === "tennis") {
    out.push(scored({ game, market: "Moneyline", pick: "Player A ML", odds: -110, sport }, 90));
    out.push(scored({ game, market: "Spread", pick: "Player A -3.5", odds: -110, sport }, 80));
    out.push(scored({ game, market: "Total", pick: "Over 22.5", odds: -110, sport }, 70));
  }
  if (sport === "ufc") {
    out.push(scored({ game, market: "Moneyline", pick: "Fighter A ML", odds: -110, sport }, 90));
    out.push(scored({ game, market: "Total Rounds", pick: "Over 2.5", odds: -110, sport }, 80));
    out.push(scored({ game, market: "Alt Total Rounds", pick: "Over 1.5", odds: -110, sport }, 70));
  }
  return out;
}

const GAMES: Record<string, string> = {
  nfl: "Vikings @ Saints",
  ncaaf: "Auburn @ Alabama",
  nba: "Celtics @ Lakers",
  wnba: "Aces @ Liberty",
  mlb: "Yankees @ Red Sox",
  nhl: "Bruins @ Rangers",
  soccer: "France @ Brazil",
  tennis: "Player A @ Player B",
  ufc: "Fighter A @ Fighter B",
};

test("report per-sport 4/5/8/10 single-event seat results", () => {
  const report: Array<Record<string, unknown>> = [];
  for (const [sport, game] of Object.entries(GAMES)) {
    for (const t of [4, 5, 8, 10] as const) {
      const ask = sport === "nfl" ? `${t} leg Saints` : `${t} leg same game for ${game}`;
      const { picks, breakdown } = buildStagedTicketFromScan(rich(sport, game), t, undefined, {
        askText: ask,
        singleEventSport: sport,
        singleEventKey: game,
      });
      const props = picks.filter((p) => p.isProp).length;
      const gls = picks.filter((p) => !p.isProp).length;
      const caps = SINGLE_EVENT_CAPS[t];
      assert.ok(props <= caps.maxProps);
      assert.ok(gls <= caps.maxGameEventLines);
      report.push({
        sport,
        target: t,
        seated: picks.length,
        props,
        gls,
        maxProps: caps.maxProps,
        maxGl: caps.maxGameEventLines,
        limitingRule: breakdown.limitingRule ?? null,
      });
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ perSportResults: report }, null, 2));
});
