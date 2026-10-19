import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowOtaHomeDiagnostics } from "./navMenuAuth.ts";

test("Home diagnostics stay hidden in production and visible on test channels", () => {
  for (const [channel, isDev, expected] of [
    ["production", false, false], ["PRODUCTION", true, false],
    ["preview", false, true], ["development", false, true],
    ["", false, false], [null, false, false], ["", true, true],
  ] as const) assert.equal(shouldShowOtaHomeDiagnostics(channel, isDev), expected);
});
