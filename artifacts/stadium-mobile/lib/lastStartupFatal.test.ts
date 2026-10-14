import assert from "node:assert/strict";
import test from "node:test";

import {
  _resetLastStartupFatalForTests,
  captureLastStartupFatal,
  formatLastStartupFatalLines,
  parseLastStartupFatal,
  peekLastStartupFatalMemory,
  readLastStartupFatal,
} from "./lastStartupFatal.ts";

test("parseLastStartupFatal rejects empty / corrupt payloads", () => {
  assert.equal(parseLastStartupFatal(null), null);
  assert.equal(parseLastStartupFatal(""), null);
  assert.equal(parseLastStartupFatal("{"), null);
  assert.equal(parseLastStartupFatal(JSON.stringify({ message: "" })), null);
});

test("captureLastStartupFatal persists and formats for Home copy", async () => {
  _resetLastStartupFatalForTests();
  let stored: string | null = null;
  const storage = {
    read: async () => stored,
    write: async (raw: string) => {
      stored = raw;
    },
  };

  captureLastStartupFatal(
    {
      message: "Cannot find native module 'ClerkExpoPasskeys'",
      stack: "Error: Cannot find native module 'ClerkExpoPasskeys'\n    at requireNativeModule",
      updateId: "01a136bb-633c-7edf-9d49-9626be829d5f",
      isFatal: true,
    },
    storage,
  );

  // Allow the fire-and-forget write to settle.
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(
    peekLastStartupFatalMemory()?.message,
    "Cannot find native module 'ClerkExpoPasskeys'",
  );
  const fromDisk = await readLastStartupFatal({
    read: async () => stored,
  });
  assert.equal(fromDisk?.message, "Cannot find native module 'ClerkExpoPasskeys'");
  assert.equal(fromDisk?.updateId, "01a136bb-633c-7edf-9d49-9626be829d5f");

  const lines = formatLastStartupFatalLines(fromDisk);
  assert.match(lines.join("\n"), /Cannot find native module 'ClerkExpoPasskeys'/);
  assert.match(lines.join("\n"), /01a136bb/);
});

test("formatLastStartupFatalLines empty state is explicit", () => {
  const lines = formatLastStartupFatalLines(null);
  assert.deepEqual(lines, ["(no captured JS fatal on this device)"]);
});
