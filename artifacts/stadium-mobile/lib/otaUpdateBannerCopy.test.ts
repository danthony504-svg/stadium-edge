/**
 * Guardrail: OTA banner must identify the pending target accurately.
 * Never describe a rollback (or any update) as "latest Discover + Coach fixes".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("OtaUpdateBanner never uses Discover+Coach marketing copy for pending updates", () => {
  const src = readFileSync(
    join(root, "components/OtaUpdateBanner.tsx"),
    "utf8",
  );
  // Strip block comments so guardrail docs do not trip the marketing ban.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /Discover\s*\+\s*Coach\s+fixes/i);
  assert.doesNotMatch(code, /latest Discover/i);
  assert.match(code, /Recovery update ready/);
  assert.match(code, /return to embedded/);
  assert.match(code, /running \$\{shortId/);
});

test("OtaController rollback path uses embedded sentinel, not tip marketing labels", () => {
  const src = readFileSync(join(root, "lib/ota/OtaController.ts"), "utf8");
  assert.match(src, /OTA_EMBEDDED_TARGET_ID/);
  assert.match(src, /isRollBackToEmbedded/);
  assert.doesNotMatch(src, /Discover\s*\+\s*Coach/);
});
