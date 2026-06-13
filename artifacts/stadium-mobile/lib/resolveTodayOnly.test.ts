import { test } from "node:test";
import assert from "node:assert/strict";
import { isPickable, isPregameBettable, resolveTodayOnly } from "./slate.ts";

// ISO string offset from now, in hours.
const at = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * 3600_000).toISOString();

// Noon TOMORROW, local time. Always on a different local calendar day than now
// AND always within the 48h pickable window (≤ ~36h out) regardless of the clock
// — so it is pickable but NEVER "today & upcoming". Anchoring to the calendar
// (not a raw hour offset) keeps the fixture stable whatever time the suite runs.
function tomorrowNoonLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

// The last minute of TODAY, local time. Future + same local day => the only
// fixture that should register as "today & upcoming". Returns null only in the
// final minute before midnight, when no "later today" time can exist.
function lateTodayLocalOrNull(): string | null {
  const now = new Date();
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.getTime() > now.getTime() ? d.toISOString() : null;
}

test("not requested -> always false (no restriction)", () => {
  assert.equal(resolveTodayOnly(false, [at(1), at(2)]), false);
  assert.equal(resolveTodayOnly(false, []), false);
});

test("late evening, tonight's slate started + rest are tomorrow -> drops restriction", () => {
  // The exact reported bug: user asks "tonight" at ~8pm. The only game on the
  // local day already started (1h ago) and everything else is on TOMORROW's
  // local date. No game qualifies as today-and-upcoming, so the restriction must
  // be dropped (false) rather than emptying the board.
  const startedTonight = at(-1);
  const tomorrowSlate = [tomorrowNoonLocal(), tomorrowNoonLocal()];
  assert.equal(
    resolveTodayOnly(true, [startedTonight, ...tomorrowSlate]),
    false,
    "no today-upcoming game -> fall back to the 48h window",
  );
});

test("requested with a real today-upcoming game -> keeps restriction", () => {
  const laterToday = lateTodayLocalOrNull();
  if (laterToday === null) return; // final minute before midnight; can't represent "later today"
  assert.equal(
    resolveTodayOnly(true, [at(-1), laterToday, tomorrowNoonLocal()]),
    true,
    "an unstarted game later on the local day keeps the today-only filter on",
  );
});

test("requested but empty pool -> false (nothing to restrict)", () => {
  assert.equal(resolveTodayOnly(true, []), false);
});

test("only already-started games -> false", () => {
  assert.equal(resolveTodayOnly(true, [at(-1), at(-2)]), false);
});

test("only games beyond the 48h pickable window -> false", () => {
  assert.equal(resolveTodayOnly(true, [at(60), at(72)]), false);
});

// isPregameBettable: the coach betting pool gate. STRICTER than isPickable —
// excludes in-progress games whose posted line is frozen (the Diamondbacks bug:
// a game started 2.5h ago still passed isPickable, so its stale pregame ML got
// recommended as a "value" pick).
test("isPregameBettable excludes already-started games that isPickable still allows", () => {
  const started = at(-2.5); // started 2.5h ago — inside isPickable's 4h grace
  assert.equal(isPickable(started), true, "isPickable keeps it for slate screens");
  assert.equal(isPregameBettable(started), false, "but the coach pool must drop it");
});

test("isPregameBettable keeps unstarted games inside the 48h window", () => {
  assert.equal(isPregameBettable(at(1)), true);
  assert.equal(isPregameBettable(at(36)), true);
});

test("isPregameBettable excludes games beyond the 48h window and bad/empty input", () => {
  assert.equal(isPregameBettable(at(60)), false);
  assert.equal(isPregameBettable(null), false);
  assert.equal(isPregameBettable(undefined), false);
  assert.equal(isPregameBettable("not-a-date"), false);
});
