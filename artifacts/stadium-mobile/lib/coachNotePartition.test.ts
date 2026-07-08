import assert from "node:assert/strict";
import { test } from "node:test";

import { partitionCoachNotes } from "./coachNotePartition.ts";

test("partitionCoachNotes routes optimizer blob to collapsed detail", () => {
  const leg = `_Your 8-leg ticket is built from player props and alt rungs on the live board — not the model's chalk moneyline scaffold._

_After the 10k sim, 3 game lines on this ticket use the highest Final AI Score among posted ML / spread / alt / total / team-total rungs:_
• Giants -1 (Alt Spread) — Final AI B+, sim 49%, edge +2%
• Braves -1 (Alt Spread) — Final AI B, sim 49%, edge —`;

  const { shortfall, detail } = partitionCoachNotes(leg);
  assert.equal(shortfall, "");
  assert.match(detail, /built from player props/i);
  assert.match(detail, /after the 10k sim/i);
});

test("partitionCoachNotes keeps shortfall visible", () => {
  const leg =
    "You asked for 10 legs, but only 7 held up against the real odds — that's the honest ticket, I won't pad it with invented legs.";
  const { shortfall, detail } = partitionCoachNotes(leg);
  assert.match(shortfall, /asked for 10 legs/i);
  assert.equal(detail, "");
});

test("partitionCoachNotes prefers stored coachDetailNote", () => {
  const { detail } = partitionCoachNotes("", "Stored optimizer note");
  assert.equal(detail, "Stored optimizer note");
});
