/**
 * Structural regressions for the phone five-leg 75s budget acceptance failure:
 * full tickets must not paint budget-stop copy; absolute flush revalidates;
 * early complete tickets terminate without waiting for the wall.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { coachAbsoluteBudgetMs } from "./coach/session.ts";
import {
  coachBudgetStopNoteShouldShow,
  coachTerminalTicketIsComplete,
} from "./coachTicketHold.ts";
import { buildFinalCoachParlayNote } from "./boardScanPropDelivery.ts";

const coachSrc = readFileSync(
  join(process.cwd(), "app/(tabs)/coach.tsx"),
  "utf8",
);
const holdSrc = readFileSync(
  join(process.cwd(), "lib/coachTicketHold.ts"),
  "utf8",
);
const noteSrc = readFileSync(
  join(process.cwd(), "lib/boardScanPropDelivery.ts"),
  "utf8",
);
const buildSrc = readFileSync(
  join(process.cwd(), "lib/coach/buildParlay.ts"),
  "utf8",
);

test("5-leg absolute budget is 75s", () => {
  assert.equal(coachAbsoluteBudgetMs(5), 75_000);
});

test("coach.tsx early-terminals when partials reach a complete revalidated ticket", () => {
  assert.match(coachSrc, /coachTerminalTicketIsComplete/);
  assert.match(coachSrc, /onPartialPicks/);
  assert.match(
    coachSrc,
    /Early success before the absolute budget/,
    "early terminal comment documents the five-leg hang fix",
  );
  // Late upgrade must clear budget copy on full tickets.
  assert.match(coachSrc, /lateFull/);
  assert.match(coachSrc, /Full late ticket: never keep timedOut budget-stop copy/);
  // Normal finish path also suppresses budget copy on complete tickets.
  assert.match(
    coachSrc,
    /Full N\/N after revalidation — never surface budget-stop copy/,
  );
});

test("flush path revalidates seats including ALT before latch", () => {
  assert.match(holdSrc, /revalidateCoachTerminalDeliveryPicks/);
  assert.match(holdSrc, /filterFlushKnownStartedPicks/);
  assert.match(holdSrc, /filterQualifiedFlushSeats/);
  assert.match(holdSrc, /applyDeliveryGroundingGate/);
  assert.match(buildSrc, /revalidateCoachTerminalDeliveryPicks/);
});

test("budget-stop note gated on incomplete tickets only", () => {
  assert.match(
    noteSrc,
    /timedOut && opts\.picks\.length < opts\.target/,
  );
  assert.equal(
    coachBudgetStopNoteShouldShow({ timedOut: true, pickCount: 5, target: 5 }),
    false,
  );
  assert.equal(
    coachBudgetStopNoteShouldShow({ timedOut: true, pickCount: 4, target: 5 }),
    true,
  );
  assert.equal(
    coachTerminalTicketIsComplete({ picks: new Array(5), requestedLegs: 5 }),
    true,
  );

  const note = buildFinalCoachParlayNote({
    target: 5,
    picks: Array.from({ length: 5 }, () => ({ isProp: false, market: "Spread" })),
    propPoolSize: 100,
    propsPending: false,
    shortfallLead: "",
    timedOut: true,
    budgetMs: 75_000,
  });
  assert.equal(note, "");
  assert.doesNotMatch(note, /Stopped at the 75s/i);
});
