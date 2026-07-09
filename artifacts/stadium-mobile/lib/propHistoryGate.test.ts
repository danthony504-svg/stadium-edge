import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  dropUngroundedPropPicks,
  propHasGroundedGameLog,
  propPoolEntryHasGroundedHistory,
} from "./propHistoryGate.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";

const jarvisPick: ParsedPick = {
  game: "Atlanta Braves @ Pittsburgh Pirates",
  market: "Stolen Bases",
  pick: "James Jarvis Over 0.5 Stolen Bases",
  odds: 920,
  isProp: true,
  player: "James Jarvis",
  athleteId: "999",
  propMarketKey: "batter_stolen_bases",
  propLine: 0.5,
  propSide: "Over",
};

test("propHasGroundedGameLog rejects props with no playerHistory", () => {
  assert.equal(propHasGroundedGameLog(jarvisPick, {}), false);
  assert.equal(propHasGroundedGameLog(jarvisPick, undefined), false);
});

test("propHasGroundedGameLog accepts props with enough SB games in log", () => {
  const history: Record<string, PlayerHistorySlice> = {
    "James Jarvis#999": {
      player: "James Jarvis",
      recent: [
        { stats: { SB: "1" } },
        { stats: { SB: "0" } },
        { stats: { SB: "1" } },
        { stats: { SB: "0" } },
      ],
    },
  };
  assert.equal(propHasGroundedGameLog(jarvisPick, history), true);
});

test("dropUngroundedPropPicks keeps game lines and drops thin props", () => {
  const ml: ParsedPick = {
    game: "A @ B",
    market: "Moneyline",
    pick: "Team A ML",
    odds: -110,
    isProp: false,
  };
  const history: Record<string, PlayerHistorySlice> = {
    "Other#1": {
      player: "Other",
      recent: [{ stats: { H: "2" } }, { stats: { H: "1" } }, { stats: { H: "3" } }],
    },
  };
  const hitsPick: ParsedPick = {
    ...jarvisPick,
    player: "Other",
    athleteId: "1",
    market: "Hits",
    propMarketKey: "batter_hits",
    pick: "Other Over 1.5 Hits",
  };
  const { picks, dropped } = dropUngroundedPropPicks([ml, jarvisPick, hitsPick], history);
  assert.equal(picks.length, 2);
  assert.ok(picks.some((p) => p.player === "Other"));
  assert.ok(!picks.some((p) => p.player === "James Jarvis"));
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]?.player, "James Jarvis");
});

test("propPoolEntryHasGroundedHistory gates backfill candidates", () => {
  const history: Record<string, PlayerHistorySlice> = {
    "James Jarvis#999": {
      player: "James Jarvis",
      recent: [{ stats: { SB: "0" } }],
    },
  };
  assert.equal(
    propPoolEntryHasGroundedHistory(
      { player: "James Jarvis", athleteId: "999", marketKey: "batter_stolen_bases" },
      history,
    ),
    false,
  );
});
