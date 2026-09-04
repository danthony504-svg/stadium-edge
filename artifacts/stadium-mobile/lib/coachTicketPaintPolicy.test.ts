import assert from "node:assert/strict";
import test from "node:test";
import {
  gatedCoachDisplayPickCount,
  shouldPaintCoachBoardTicket,
} from "./coachTicketPaintPolicy.ts";

test("shouldPaintCoachBoardTicket waits for leg target or scan complete", () => {
  assert.equal(
    shouldPaintCoachBoardTicket({
      parlayBuildIntent: true,
      ticketLegTarget: 15,
      stagedPickCount: 5,
      scanComplete: false,
    }),
    false,
  );
  assert.equal(
    shouldPaintCoachBoardTicket({
      parlayBuildIntent: true,
      ticketLegTarget: 15,
      stagedPickCount: 15,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    shouldPaintCoachBoardTicket({
      parlayBuildIntent: true,
      ticketLegTarget: 15,
      stagedPickCount: 4,
      scanComplete: true,
    }),
    true,
  );
});

test("gatedCoachDisplayPickCount hides picks while scan is in progress", () => {
  assert.equal(
    gatedCoachDisplayPickCount({
      parlayBuildIntent: true,
      ticketLegTarget: 15,
      displayPicksCount: 5,
      rawPicksCount: 5,
      scanComplete: false,
      stagedPickCount: 5,
    }),
    0,
  );
  assert.equal(
    gatedCoachDisplayPickCount({
      parlayBuildIntent: true,
      ticketLegTarget: 15,
      displayPicksCount: 15,
      rawPicksCount: 15,
      scanComplete: false,
      stagedPickCount: 15,
    }),
    15,
  );
});
