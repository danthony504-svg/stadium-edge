import assert from "node:assert/strict";
import test from "node:test";
import {
  gameAltPoolForPick,
  isAlternateOrPeriodMarket,
  isMainLineGameLeg,
  isPostablePoolLadderOdds,
  isQualifyingBackupGameLine,
  ladderTierForSiblingIndex,
  poolMatchesPickFamily,
} from "./altLinePool.ts";
import type { RealOddsEntry } from "./api.ts";

const pick = {
  game: "New York Yankees @ Washington Nationals",
  market: "Alt Spread",
  pick: "Yankees -2",
};

const evalLines: RealOddsEntry[] = [
  { sport: "mlb", game: pick.game, market: "Spread", pick: "Yankees -1.5", odds: -110 },
  { sport: "mlb", game: pick.game, market: "Alt Spread", pick: "Yankees -2", odds: 105 },
  { sport: "mlb", game: pick.game, market: "Alt Spread", pick: "Yankees -3.5", odds: 180 },
  { sport: "mlb", game: pick.game, market: "F5 Run Line", pick: "Yankees -1.5", odds: 120 },
  { sport: "mlb", game: pick.game, market: "Alt Total", pick: "Over 9", odds: 110 },
];

test("poolMatchesPickFamily groups spread, alt spread, and period run lines", () => {
  assert.ok(poolMatchesPickFamily(evalLines[0]!, pick));
  assert.ok(poolMatchesPickFamily(evalLines[2]!, pick));
  assert.ok(poolMatchesPickFamily(evalLines[3]!, pick));
  assert.ok(!poolMatchesPickFamily(evalLines[4]!, pick));
});

test("isAlternateOrPeriodMarket rejects main ML but accepts alt spread and F5", () => {
  assert.ok(!isAlternateOrPeriodMarket("Moneyline"));
  assert.ok(!isAlternateOrPeriodMarket("Spread"));
  assert.ok(isAlternateOrPeriodMarket("Alt Spread"));
  assert.ok(isAlternateOrPeriodMarket("F5 Run Line"));
  assert.ok(isAlternateOrPeriodMarket("1H Alt Total"));
});

test("gameAltPoolForPick returns every same-side spread-family rung", () => {
  const pool = gameAltPoolForPick(pick, evalLines);
  assert.equal(pool.length, 4);
});

test("isMainLineGameLeg rejects main ML even when market label is empty", () => {
  assert.ok(
    isMainLineGameLeg({
      market: "",
      pick: "Pittsburgh Pirates ML",
    }),
  );
  assert.ok(
    isMainLineGameLeg({
      market: "Moneyline",
      pick: "Pirates ML",
    }),
  );
  assert.ok(
    !isMainLineGameLeg({
      market: "Alt Spread",
      pick: "Pirates +2.5",
    }),
  );
  assert.ok(
    !isMainLineGameLeg({
      market: "F5 Run Line",
      pick: "Pirates +1.5",
    }),
  );
});

test("isQualifyingBackupGameLine accepts alt spread but rejects main ML", () => {
  assert.ok(
    isQualifyingBackupGameLine({
      market: "Alt Spread",
      pick: "Pirates +2.5",
    }),
  );
  assert.ok(
    !isQualifyingBackupGameLine({
      market: "Moneyline",
      pick: "Pirates ML",
    }),
  );
  assert.ok(
    !isQualifyingBackupGameLine({
      market: "",
      pick: "Pittsburgh Pirates ML",
    }),
  );
});

test("ladderTierForSiblingIndex labels lowest line Safest and highest High Risk", () => {
  assert.equal(ladderTierForSiblingIndex(0, 3), "Safest");
  assert.equal(ladderTierForSiblingIndex(2, 3), "High Risk");
});

test("isPostablePoolLadderOdds rejects junk +40000 alt rungs", () => {
  assert.ok(isPostablePoolLadderOdds(1100));
  assert.ok(!isPostablePoolLadderOdds(40000));
});
