import assert from "node:assert/strict";
import test from "node:test";

import {
  fullBoardScanShortfallNote,
  fullBoardScanSuccessNote,
} from "./fullBoardMarketCopy.ts";
import { buildFinalCoachParlayNote } from "./boardScanPropDelivery.ts";
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";

test("fullBoardScanSuccessNote is hidden from Coach chat", () => {
  assert.equal(fullBoardScanSuccessNote(10590, 7), "");
});

test("props-only shortfall note is hidden (no moneylines/spreads essay)", () => {
  const note = fullBoardScanShortfallNote(8102, 9, 8, {
    mainQualified: 9,
    altQualified: 0,
    mainOnTicket: 8,
    altOnTicket: 0,
  }, { propsOnly: true });
  assert.equal(note, "");
  assert.doesNotMatch(note, /moneyline/i);
  assert.doesNotMatch(note, /spread/i);
});

test("mix shortfall note still describes the full board", () => {
  const note = fullBoardScanShortfallNote(8102, 9, 8, {
    mainQualified: 9,
    altQualified: 0,
    mainOnTicket: 8,
    altOnTicket: 0,
  });
  assert.match(note, /moneylines/i);
  assert.match(note, /spreads/i);
  assert.match(note, /\*\*8\*\*/);
});

test("props-only shortfall falls through to honest fixed-leg lead (screenshot)", () => {
  // After props-only scan note is "", delivery uses the shortfall lead —
  // not the full-board essay that listed moneylines for a props ask.
  const scanNote = fullBoardScanShortfallNote(8102, 9, 8, undefined, {
    propsOnly: true,
  });
  const shortfallLead = buildFixedLegCountShortfallLead(9, 8);
  const note = buildFinalCoachParlayNote({
    target: 9,
    picks: Array.from({ length: 8 }, () => ({ isProp: true, market: "RUSH ATTEMPTS" })),
    propPoolSize: 400,
    propsPending: false,
    shortfallLead,
    scanNote,
  });
  assert.match(note, /asked for \*\*9\*\*/i);
  assert.match(note, /only \*\*8\*\*/i);
  assert.doesNotMatch(note, /moneylines/i);
  assert.doesNotMatch(note, /entire board/i);
});
