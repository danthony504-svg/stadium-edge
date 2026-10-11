/**
 * Post-publish / post-merge Coach ask proofs:
 * - 8 leg Saints
 * - NBA / MLB / NHL single-team/game asks
 *
 * Confirms higher single-event capacity when independents exist, and honest
 * underfill when the board cannot safely fill N.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ParsedPick } from "../components/PickCard.tsx";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import { SINGLE_EVENT_CAPS, shouldActivateSingleEventSeating } from "./singleEventSeating.ts";
import { marketLadderKey } from "./marketLadderKey.ts";

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
    pick: { isProp: false, finalAiScore: mainScore, ...pick },
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

function richBoard(
  sport: string,
  game: string,
  propMarkets: string[],
  thin = false,
): BoardScoredLeg[] {
  const out: BoardScoredLeg[] = [];
  let r = 300;
  const players = thin
    ? ["Only One"]
    : ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9", "J10"];
  for (let i = 0; i < players.length; i++) {
    const m = propMarkets[i % propMarkets.length]!;
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
  out.push(scored({ game, market: "1H Spread", pick: `${game.split(" @ ")[0]} +1.5`, odds: -110, sport }, r--));
  out.push(
    scored(
      {
        game: "Noise Away @ Noise Home",
        market: propMarkets[0]!,
        pick: "Noise Over 99",
        odds: -110,
        isProp: true,
        player: "Noise Guy",
        propLine: 99,
        propSide: "Over",
        sport,
      },
      1,
    ),
  );
  return out;
}

const CASES = [
  {
    name: "8 leg Saints",
    ask: "8 leg Saints",
    sport: "nfl",
    game: "Vikings @ Saints",
    props: ["Pass Yds", "Rush Yds", "Rec Yds", "Receptions", "Pass TDs", "Anytime TD", "Sacks", "Rush Attempts"],
  },
  {
    name: "NBA Lakers game",
    ask: "8 leg same game for Celtics @ Lakers",
    sport: "nba",
    game: "Celtics @ Lakers",
    props: ["Points", "Rebounds", "Assists", "Threes", "Steals", "Blocks", "Turnovers", "PRA"],
  },
  {
    name: "MLB Yankees game",
    ask: "8 leg same game for Yankees @ Red Sox",
    sport: "mlb",
    game: "Yankees @ Red Sox",
    props: ["Hits", "Total Bases", "Home Runs", "Strikeouts", "RBIs", "Runs", "Stolen Bases", "Outs"],
  },
  {
    name: "NHL Rangers game",
    ask: "8 leg same game for Bruins @ Rangers",
    sport: "nhl",
    game: "Bruins @ Rangers",
    props: ["Points", "Goals", "Assists", "Shots on Goal", "Points", "Goals", "Assists", "Shots on Goal"],
  },
] as const;

test("post-publish proofs: Saints + NBA + MLB + NHL single-event capacity and underfill", () => {
  const report: Array<Record<string, unknown>> = [];
  const caps = SINGLE_EVENT_CAPS[8];

  for (const c of CASES) {
    assert.equal(shouldActivateSingleEventSeating(c.ask), true, c.name);

    const rich = buildStagedTicketFromScan(richBoard(c.sport, c.game, [...c.props]), 8, undefined, {
      askText: c.ask,
      singleEventSport: c.sport,
      singleEventKey: c.game,
    });
    const props = rich.picks.filter((p) => p.isProp);
    const gls = rich.picks.filter((p) => !p.isProp);
    assert.equal(rich.picks.length, 8, `${c.name} rich board should fill 8`);
    assert.ok(props.length <= caps.maxProps);
    assert.ok(gls.length <= caps.maxGameEventLines);
    assert.ok(rich.picks.every((p) => p.game === c.game), `${c.name} event lock`);
    assert.equal(new Set(props.map((p) => p.player)).size, props.length);
    assert.equal(new Set(rich.picks.map((p) => marketLadderKey(p))).size, rich.picks.length);

    const thin = buildStagedTicketFromScan(
      richBoard(c.sport, c.game, [...c.props], true),
      8,
      undefined,
      {
        askText: c.ask,
        singleEventSport: c.sport,
        singleEventKey: c.game,
      },
    );
    assert.ok(thin.picks.length < 8, `${c.name} thin board must underfill`);
    assert.ok(
      thin.breakdown.limitingRule?.startsWith("single_event_"),
      `${c.name} needs honest limiter`,
    );

    report.push({
      ask: c.name,
      activation: true,
      richSeated: rich.picks.length,
      richProps: props.length,
      richGls: gls.length,
      thinSeated: thin.picks.length,
      thinLimiter: thin.breakdown.limitingRule,
    });
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ postPublishAskProofs: report }, null, 2));
});
