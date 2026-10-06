import assert from "node:assert/strict";
import test from "node:test";

import {
  fullBoardScanShortfallNote,
  fullBoardScanSuccessNote,
} from "./fullBoardMarketCopy.ts";
import { buildFullBoardShortfallNote } from "./parlayReachCore.ts";
import { buildFinalCoachParlayNote } from "./boardScanPropDelivery.ts";
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";

function assertNoStaleStagedCopy(note: string) {
  // Shortfall notes that know requested must never cite intermediate pools.
  if (/You asked for \d+ legs\./i.test(note)) {
    assert.doesNotMatch(note, /\d+ main lines and \d+ alt lines cleared/i);
    assert.doesNotMatch(note, /Filled with \d+ main pick/);
  }
}

test("fullBoardScanSuccessNote is hidden from Coach chat", () => {
  assert.equal(fullBoardScanSuccessNote(10590, 7), "");
  assert.equal(fullBoardScanSuccessNote(2227, 10), "");
});

test("props-only shortfall note is hidden (no moneylines/spreads essay)", () => {
  const note = fullBoardScanShortfallNote(
    8102,
    9,
    8,
    {
      mainQualified: 9,
      altQualified: 0,
      mainOnTicket: 8,
      altOnTicket: 0,
    },
    { propsOnly: true },
  );
  assert.equal(note, "");
  assert.doesNotMatch(note, /moneyline/i);
  assert.doesNotMatch(note, /spread/i);
});

test("10 leg Saints → final 7 copy says 7 with correct 4 main + 3 ALT", () => {
  const note = fullBoardScanShortfallNote(
    2227,
    28,
    7,
    {
      // Intermediate pool (must not appear)
      mainQualified: 20,
      altQualified: 7,
      // Final delivered composition (live audit)
      mainOnTicket: 4,
      altOnTicket: 3,
    },
    { requested: 10 },
  );
  assert.match(
    note,
    /You asked for 10 legs\. 7 qualified picks were available, so no filler was added\./,
  );
  assert.match(
    note,
    /Ticket composition: 4 main picks and 3 alt picks \(labeled ALT PICK\)\./,
  );
  assert.doesNotMatch(note, /20 main/);
  assert.doesNotMatch(note, /7 alt lines cleared/);
  assert.doesNotMatch(note, /Filled with 3 main/);
  assert.doesNotMatch(note, /These 7 are/);
  assertNoStaleStagedCopy(note);
});

test("5/10 shortfall → copy says 5", () => {
  const note = fullBoardScanShortfallNote(
    1800,
    40,
    5,
    { mainQualified: 30, altQualified: 10, mainOnTicket: 4, altOnTicket: 1 },
    { requested: 10 },
  );
  assert.match(
    note,
    /You asked for 10 legs\. 5 qualified picks were available, so no filler was added\./,
  );
  assert.match(note, /Ticket composition: 4 main picks and 1 alt pick/);
  assert.doesNotMatch(note, /30 main/);
  assertNoStaleStagedCopy(note);
});

test("full 10/10 ticket → copy describes 10 and composition matches final", () => {
  // Scanner hides success notes (""); when/if shortfall helper is used at full
  // count (actual >= requested), composition must still match final ticket.
  assert.equal(fullBoardScanSuccessNote(3000, 10), "");

  const note = fullBoardScanShortfallNote(
    3000,
    50,
    10,
    { mainQualified: 40, altQualified: 12, mainOnTicket: 7, altOnTicket: 3 },
    { requested: 10 },
  );
  // Not a shortfall path — falls through to "These 10" with matching roles.
  assert.doesNotMatch(note, /qualified picks were available/);
  assert.match(note, /These 10 are/);
  assert.match(note, /Filled with 7 main picks and 3 alt picks/);
  assert.doesNotMatch(note, /40 main lines/);
  assert.doesNotMatch(note, /12 alt lines cleared/);

  const reach = buildFullBoardShortfallNote(10, 10, 3000, 50, "today's real odds", undefined, {
    mainQualified: 40,
    altQualified: 12,
    mainOnTicket: 7,
    altOnTicket: 3,
  });
  assert.match(reach, /These 10 are/);
  assert.match(reach, /7 main picks and 3 alt picks/);
  assert.doesNotMatch(reach, /\b40\b/);
  assert.doesNotMatch(reach, /\b50\b/);
});

test("ALT-only ticket composition matches delivered ticket", () => {
  const note = fullBoardScanShortfallNote(
    900,
    8,
    3,
    { mainQualified: 0, altQualified: 8, mainOnTicket: 0, altOnTicket: 3 },
    { requested: 6 },
  );
  assert.match(
    note,
    /You asked for 6 legs\. 3 qualified picks were available, so no filler was added\./,
  );
  assert.match(note, /Ticket composition: 0 main picks and 3 alt picks/);
  assert.doesNotMatch(note, /8 alt lines cleared/);
  assertNoStaleStagedCopy(note);
});

test("mixed ticket: stale staged 3+1 cannot appear when final is 7", () => {
  const note = fullBoardScanShortfallNote(
    2225,
    27,
    7,
    {
      mainQualified: 20,
      altQualified: 7,
      mainOnTicket: 3, // stale staged snapshot
      altOnTicket: 1,
    },
    { requested: 10 },
  );
  // Roles don't sum to final → omit composition rather than lie.
  assert.match(note, /7 qualified picks were available/);
  assert.doesNotMatch(note, /Ticket composition/);
  assert.doesNotMatch(note, /3 main pick/);
  assert.doesNotMatch(note, /1 alt pick/);
  assert.doesNotMatch(note, /20 main lines and 7 alt lines cleared/);
  assertNoStaleStagedCopy(note);
});

test("no stale staged.breakdown pool counts in final Coach delivery note", () => {
  const scanNote = fullBoardScanShortfallNote(
    2227,
    28,
    7,
    { mainQualified: 20, altQualified: 7, mainOnTicket: 4, altOnTicket: 3 },
    { requested: 10 },
  );
  const delivered = buildFinalCoachParlayNote({
    target: 10,
    picks: Array.from({ length: 7 }, (_, i) => ({
      isProp: i < 2,
      market: i < 2 ? "Receptions" : "Spread",
    })),
    propPoolSize: 916,
    propsPending: false,
    shortfallLead: buildFixedLegCountShortfallLead(10, 7),
    scanNote,
  });
  assert.match(delivered, /7 qualified picks were available/);
  assert.match(delivered, /4 main picks and 3 alt picks/);
  assert.doesNotMatch(delivered, /20 main lines and 7 alt lines cleared/);
  assert.doesNotMatch(delivered, /Filled with 3 main/);
});

test("props-only shortfall falls through to honest fixed-leg lead (screenshot)", () => {
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
