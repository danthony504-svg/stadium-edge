import assert from "node:assert/strict";
import test from "node:test";

import {
  isSlipPhotoVisionOnly,
  MAX_COACH_IMAGES,
  wantsAnalyzeSlip,
  wantsImproveSlip,
} from "./coachPhotoUpload.ts";
import {
  filterPicksByAskMarketConstraint,
  parseCoachAskMarketConstraint,
} from "./coachAskMarketFilter.ts";
import { askAllowsNcaafPlayerProps } from "./boardScanPropDelivery.ts";

test("MAX_COACH_IMAGES matches server vision cap of 3", () => {
  assert.equal(MAX_COACH_IMAGES, 3);
});

test("phone ask: 5 leg touchdown → props-only TD markets (not game lines)", () => {
  const c = parseCoachAskMarketConstraint("5 leg touchdown");
  assert.equal(c.propsOnly, true);
  assert.ok(c.allowedMarketKeys?.includes("player_anytime_td"));
  assert.ok(c.allowedMarketKeys?.includes("player_first_td"));
  assert.ok(!c.gameLinesOnly);
});

test("5 leg touchdown filter drops spreads (phone Air Force 1H leak)", () => {
  const c = parseCoachAskMarketConstraint("5 leg touchdown");
  const out = filterPicksByAskMarketConstraint(
    [
      {
        isProp: false,
        market: "1H SPREAD",
        pick: "Air Force Falcons +1.5",
      },
      {
        isProp: true,
        market: "ANYTIME TD",
        propMarketKey: "player_anytime_td",
        pick: "Jeanty Anytime TD",
      },
    ],
    c,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.propMarketKey, "player_anytime_td");
});

test("phone ask: 5 leg td / anytime td / first td market locks", () => {
  assert.equal(parseCoachAskMarketConstraint("5 leg td").propsOnly, true);
  assert.ok(
    parseCoachAskMarketConstraint("6 leg anytime td").allowedMarketKeys?.includes(
      "player_anytime_td",
    ),
  );
  assert.deepEqual(
    parseCoachAskMarketConstraint("4 leg first touchdown").allowedMarketKeys,
    ["player_first_td"],
  );
});

test("touchdown ask allows NCAAF player props", () => {
  assert.equal(askAllowsNcaafPlayerProps("5 leg touchdown"), true);
  assert.equal(askAllowsNcaafPlayerProps("5 leg td"), true);
});

test("wantsImproveSlip mirrors better-one / do better phrasing", () => {
  assert.equal(wantsImproveSlip("give me a better one"), true);
  assert.equal(wantsImproveSlip("can you do better"), true);
  assert.equal(wantsImproveSlip("which is better"), false);
  assert.equal(wantsAnalyzeSlip("analyze my ticket"), true);
  assert.equal(wantsAnalyzeSlip("make it better"), false);
});

test("isSlipPhotoVisionOnly skips board scan for photo verdicts", () => {
  assert.equal(
    isSlipPhotoVisionOnly({
      hasImages: true,
      text: "what do you think",
    }),
    true,
  );
  assert.equal(
    isSlipPhotoVisionOnly({
      hasImages: true,
      text: "give me a better one",
    }),
    false,
  );
  assert.equal(
    isSlipPhotoVisionOnly({
      hasImages: true,
      text: "5 leg touchdown",
    }),
    true,
  );
});
