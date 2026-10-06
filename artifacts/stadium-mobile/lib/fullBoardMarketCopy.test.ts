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
  }, { requested: 10 });
  assert.match(note, /moneylines/i);
  assert.match(note, /spreads/i);
  assert.match(note, /asked for 10/i);
  assert.match(note, /8 qualified picks were available/i);
  assert.doesNotMatch(note, /\*\*/);
});

test("10-leg Saints screenshot: copy uses final ticket, not intermediate pools", () => {
  // Phone: requested 10, badge 10-Leg, "20 main + 7 alt cleared",
  // "Filled with 3 main and 1 alt", "These 7 are…" — three disagreeing counts.
  // Intermediate staging said 3+1 on ticket while final delivered 7.
  const note = fullBoardScanShortfallNote(
    2225,
    27,
    7,
    {
      mainQualified: 20,
      altQualified: 7,
      mainOnTicket: 3,
      altOnTicket: 1,
    },
    { requested: 10 },
  );
  assert.match(note, /You asked for 10 legs\. 7 qualified picks were available, so no filler was added\./);
  assert.doesNotMatch(note, /20 main/);
  assert.doesNotMatch(note, /7 alt lines cleared/);
  assert.doesNotMatch(note, /Filled with 3 main/);
  assert.doesNotMatch(note, /These 7 are/);
  // Stale 3+1 must not appear when it disagrees with final=7.
  assert.doesNotMatch(note, /3 main pick/);
  assert.doesNotMatch(note, /1 alt pick/);
});

test("shortfall role detail only when final ticket main+alt sums to pickCount", () => {
  const note = fullBoardScanShortfallNote(
    1000,
    12,
    7,
    {
      mainQualified: 10,
      altQualified: 2,
      mainOnTicket: 6,
      altOnTicket: 1,
    },
    { requested: 10 },
  );
  assert.match(note, /7 qualified picks were available/);
  assert.match(note, /Ticket composition: 6 main picks and 1 alt pick/);
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
  assert.match(note, /asked for 9/i);
  assert.match(note, /only 8/);
  assert.doesNotMatch(note, /\*\*/);
  assert.doesNotMatch(note, /moneylines/i);
  assert.doesNotMatch(note, /entire board/i);
});
