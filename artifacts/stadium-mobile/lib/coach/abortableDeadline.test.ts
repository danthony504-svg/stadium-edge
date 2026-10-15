import assert from "node:assert/strict";
import test from "node:test";

import { raceAbortableDeadline } from "./abortableDeadline.ts";

function timeoutCount(): number {
  return process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
}

test("success clears the delivery deadline timer", async () => {
  const ac = new AbortController();
  const before = timeoutCount();
  const result = await raceAbortableDeadline(
    Promise.resolve("ok"),
    75_000,
    ac.signal,
    "late",
  );
  assert.equal(result, "ok");
  assert.equal(timeoutCount(), before);
});

test("cancellation resolves the fallback and clears the deadline timer", async () => {
  const ac = new AbortController();
  const before = timeoutCount();
  const pending = raceAbortableDeadline(
    new Promise<string>(() => {}),
    75_000,
    ac.signal,
    "stopped",
  );
  ac.abort();
  assert.equal(await pending, "stopped");
  assert.equal(timeoutCount(), before);
});

test("deadline expiry resolves the fallback and leaves no timer", async () => {
  const ac = new AbortController();
  const before = timeoutCount();
  const result = await raceAbortableDeadline(
    new Promise<string>(() => {}),
    20,
    ac.signal,
    "budget",
  );
  assert.equal(result, "budget");
  assert.equal(timeoutCount(), before);
});

test("a rejected scan still clears the deadline timer", async () => {
  const ac = new AbortController();
  const before = timeoutCount();
  await assert.rejects(
    raceAbortableDeadline(
      Promise.reject(new Error("trim")),
      75_000,
      ac.signal,
      "late",
    ),
    /trim/,
  );
  assert.equal(timeoutCount(), before);
});

test("an already-aborted signal does not arm a deadline timer", async () => {
  const ac = new AbortController();
  ac.abort();
  const before = timeoutCount();
  const result = await raceAbortableDeadline(
    new Promise<string>(() => {}),
    75_000,
    ac.signal,
    "stopped",
  );
  assert.equal(result, "stopped");
  assert.equal(timeoutCount(), before);
});
