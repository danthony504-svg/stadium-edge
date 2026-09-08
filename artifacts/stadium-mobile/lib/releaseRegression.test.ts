import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("api.ts imports PROP_MARKET_LABEL_MAP before use", async () => {
  const apiSrc = readFileSync(join(root, "lib/api.ts"), "utf8");
  assert.match(apiSrc, /import\s*\{[^}]*PROP_MARKET_LABEL_MAP[^}]*\}\s*from\s*["']\.\/propMarketLabel["']/);
  const importIdx = apiSrc.indexOf("PROP_MARKET_LABEL_MAP");
  const useIdx = apiSrc.indexOf("Object.entries(PROP_MARKET_LABEL_MAP)");
  assert.ok(importIdx >= 0 && useIdx > importIdx, "PROP_MARKET_LABEL_MAP must be imported before use");
  const mod = await import("./propMarketLabel.ts");
  assert.ok(mod.PROP_MARKET_LABEL_MAP);
  assert.ok(Object.keys(mod.PROP_MARKET_LABEL_MAP).length > 0);
});

test("prefetchAndMaybeApplyOta is exported and callable", () => {
  const src = readFileSync(join(root, "lib/otaUpdater.ts"), "utf8");
  assert.match(src, /export async function prefetchAndMaybeApplyOta/);
});

test("no duplicate assistantMessagePatch exports from propSimProgressive", () => {
  const src = readFileSync(join(root, "lib/propSimProgressive.ts"), "utf8");
  assert.doesNotMatch(src, /export\s*\{[^}]*patchLastAssistantPicks[^}]*\}\s*from\s*["']\.\/assistantMessagePatch/);
});

test("pick cards preserve metric fields on ParsedPick type usage", () => {
  const pickCardSrc = readFileSync(join(root, "components/PickCard.tsx"), "utf8");
  for (const field of ["edge", "simulation", "matchup", "form", "injur", "market"]) {
    assert.match(pickCardSrc, new RegExp(field, "i"), `expected pick card surface for ${field}`);
  }
});

test("fresh deep slate pre-analysis remains terminal instead of forced preview", () => {
  const preAnalysisSrc = readFileSync(join(root, "lib/slatePreAnalysis.ts"), "utf8");
  const coachSrc = readFileSync(join(root, "app/(tabs)/coach.tsx"), "utf8");
  assert.match(preAnalysisSrc, /clean\.deepSimComplete/);
  assert.match(preAnalysisSrc, /boardScanReadyForDelivery\(boardRaw, requested\)/);
  assert.match(preAnalysisSrc, /scanComplete: terminalSeed/);
  assert.match(
    coachSrc,
    /preBoardScan = boardScanIsComplete\(preAnalysisSeed\.boardScan\)\s*\?\s*preAnalysisSeed\.boardScan/,
  );
});

test("no unresolved merge conflict markers in stadium-mobile", () => {
  const targets = ["lib/api.ts", "lib/otaUpdater.ts", "app/(tabs)/coach.tsx", "app/(tabs)/index.tsx"];
  for (const rel of targets) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.doesNotMatch(src, /^<<<<<<< /m, `${rel} has conflict markers`);
    assert.doesNotMatch(src, /^=======/m, `${rel} has conflict markers`);
    assert.doesNotMatch(src, /^>>>>>>> /m, `${rel} has conflict markers`);
  }
});
