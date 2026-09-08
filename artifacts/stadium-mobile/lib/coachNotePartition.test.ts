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

test("partitionCoachNotes keeps full-board shortfall visible", () => {
  const leg = `You asked for **8** legs — only **7** cleared the AI quality bar after every posted market was scanned. No ungraded filler was added.

I scanned **840** posted lines across every market on today's real odds — moneylines, spreads, alt spreads, totals, alt totals, player props, periods, halves, quarters, innings, and team totals — with a 10k sim on each, cross-book line shopping, correlation scoring, and historical learning from your graded results.

**12** main lines and **3** alt lines cleared quality filters — I filled with every qualifying main, then promoted alternate rungs where mains ran out. These **7** are every sim-aligned leg on today's board.`;
  const { shortfall, detail } = partitionCoachNotes(leg);
  assert.match(shortfall, /asked for \*\*8\*\* legs/i);
  assert.match(shortfall, /only \*\*7\*\*/i);
  assert.match(detail, /scanned \*\*840\*\*/i);
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

test("partitionCoachNotes keeps pipeline breakdown shortfall visible for 15-leg asks", () => {
  const leg = `You asked for **15** legs — **1** delivered after the full-board scan.

**Pipeline breakdown**
- Markets loaded: **1,200**
- Markets simulated: **1,000**
- Positive-edge candidates: **42**
- Rejected by confidence: **18**
- Rejected by correlation: **23**
- Final picks delivered: **1** of **15**

No ungraded filler or unposted odds were added.`;
  const { shortfall, detail } = partitionCoachNotes(leg);
  assert.match(shortfall, /Pipeline breakdown/i);
  assert.match(shortfall, /Markets loaded: \*\*1,200\*\*/i);
  assert.match(shortfall, /Final picks delivered: \*\*1\*\* of \*\*15\*\*/i);
  assert.equal(detail, "");
});
