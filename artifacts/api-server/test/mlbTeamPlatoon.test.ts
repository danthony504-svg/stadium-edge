import assert from "node:assert/strict";
import test from "node:test";
import { compactGamePlatoonForUpload } from "../src/lib/mlbTeamPlatoonCompact.ts";

test("compactGamePlatoonForUpload keeps team OPS and starter tendency", () => {
  const compact = compactGamePlatoonForUpload({
    game: "Chicago Cubs @ Baltimore Orioles",
    offenseLean: "away",
    note: "Cubs OPS .782 vs RHP",
    away: {
      team: "Chicago Cubs",
      opposingStarter: {
        name: "John Doe",
        throws: "Right",
        tendency: { era: 4.2, whip: 1.3, kPer9: 8.1, hrPer9: 1.5, oppOPS: 0.78, hardHitPctAllowed: 42, barrelPctAllowed: 9 },
      },
      splitVsStarterHand: {
        hand: "Right",
        sourceLine: null,
        avg: 0.25,
        obp: 0.32,
        slg: 0.42,
        ops: 0.74,
        hits: 400,
        homeRuns: 90,
        walks: 200,
        strikeouts: 500,
        plateAppearances: 2000,
        games: 90,
        kRate: 0.25,
        bbRate: 0.1,
        hitsPerGame: 4.44,
        hrPerGame: 1.0,
        iso: 0.17,
        woba: null,
        wrcPlus: null,
        hardHitRate: null,
        groundBallRate: null,
        flyBallRate: null,
      },
    },
    home: {
      team: "Baltimore Orioles",
      opposingStarter: { name: "Jane Roe", throws: "Left", tendency: null },
      splitVsStarterHand: null,
    },
  });
  assert.equal(compact.game, "Chicago Cubs @ Baltimore Orioles");
  assert.equal((compact.away as { ops: number }).ops, 0.74);
  assert.equal((compact.away as { starterHr9: number }).starterHr9, 1.5);
});
