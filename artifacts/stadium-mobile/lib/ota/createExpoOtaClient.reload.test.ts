/**
 * Guard: reloadAsync must not no-op a rollBackToEmbedded while still on a tip.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("createExpoOtaClient reloadAsync does not skip when tip id equals downloaded and pending", () => {
  const src = readFileSync(join(here, "createExpoOtaClient.ts"), "utf8");
  // Must not early-return solely because running === downloaded on non-embedded
  // (that strands channel rollback Restart). Only embedded+!pending may skip.
  assert.match(src, /isEmbeddedLaunch && !pending/);
  assert.doesNotMatch(
    src,
    /running\.trim\(\)\.toLowerCase\(\) === downloaded\.trim\(\)\.toLowerCase\(\)\s*&&\s*!Updates\.isEmbeddedLaunch/,
  );
  assert.match(src, /Distinct-target \/ already-on-target gates live in OtaController/);
});
