import assert from "node:assert/strict";
import test from "node:test";

import {
  FULL_BOARD_MARKET_FAMILIES,
  fullBoardScanShortfallNote,
  fullBoardScanSuccessNote,
  isCoachBoardScanBlurb,
} from "./fullBoardMarketCopy.ts";

test("fullBoardScanSuccessNote hides the long board-scan essay from Coach chat", () => {
  const note = fullBoardScanSuccessNote(8515, 5);
  assert.equal(note, "");
  assert.equal(isCoachBoardScanBlurb(note), false);
});

test("fullBoardScanShortfallNote stays short — no market-family laundry list", () => {
  const note = fullBoardScanShortfallNote(1200, 8, 4, {
    mainQualified: 6,
    altQualified: 2,
    mainOnTicket: 3,
    altOnTicket: 1,
  });
  assert.doesNotMatch(note, new RegExp(FULL_BOARD_MARKET_FAMILIES.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(note, /live markets, moneylines, spreads/i);
  assert.match(note, /1200/);
  assert.match(note, /Showing \*\*4\*\*/);
  assert.equal(isCoachBoardScanBlurb(note), false);
});

test("isCoachBoardScanBlurb detects legacy long scan essays", () => {
  const legacy = `_Scanned every posted line on the board — ${FULL_BOARD_MARKET_FAMILIES} (**8515** lines, 10k sim each, cross-book line shopping, correlation scoring, and historical learning applied). These **5** are the highest-rated by win probability, implied probability, EV, edge, confidence, and AI grade._`;
  assert.equal(isCoachBoardScanBlurb(legacy), true);
  assert.equal(isCoachBoardScanBlurb("Player props did not finish scoring."), false);
  assert.equal(isCoachBoardScanBlurb(""), false);
});
