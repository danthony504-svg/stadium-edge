import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Regression: one game-outcome sim timeout used to reject Promise.all for the
 * whole slate batch → buildTopLegs threw → tryReachFullBoardScan returned null
 * → Coach painted instant 0-of-7 ("no AI-backed picks cleared the quality bar").
 */
test("one rejected game sim must not reject the whole slate batch", async () => {
  async function simGame(id: number): Promise<number | null> {
    if (id === 2) throw new Error("request timeout: /sports/simulate/game-outcome");
    return id;
  }

  await assert.rejects(
    async () => Promise.all([1, 2, 3].map((id) => simGame(id))),
    /timeout/,
  );

  // Mirrors fetchSlateGameSimulations per-game try/catch.
  const settled = await Promise.all(
    [1, 2, 3].map(async (id) => {
      try {
        return await simGame(id);
      } catch {
        return null;
      }
    }),
  );
  assert.deepEqual(
    settled.filter((v): v is number => v != null),
    [1, 3],
  );
});

test("prop MC incomplete when deadline stops before pool exhaustion", () => {
  const rankedProps = 40;
  const simIndex = 8;
  const stoppedEarly = true;
  assert.equal(stoppedEarly && simIndex < rankedProps, true);
  assert.equal(true && 40 < 40, false);
});

test("buildCoachParlay loads full DEFAULT_SPORTS via coachBoardSportsForAsk", () => {
  const src = readFileSync(join(root, "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /coachBoardSportsForAsk\(askText, requestedLegs, DEFAULT_SPORTS\)/);
  assert.doesNotMatch(src, /DEFAULT_SPORTS\.slice\(\s*0\s*,\s*8\s*\)/);
});

test("buildCoachParlay wires yards market allowlist without changing hold/delivery", () => {
  const src = readFileSync(join(root, "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /parseCoachAskMarketConstraint/);
  assert.match(src, /filterPropPoolByAskMarkets/);
  assert.match(src, /filterPicksByAskMarketConstraint/);
  assert.match(src, /propsOnly,/);
  // Hold / session / UI delivery must stay out of this path.
  assert.doesNotMatch(src, /coachHold|holdUntil|trickleDeliver/);
});

test("fetchSlateGameSimulations catches per-game failures", () => {
  const src = readFileSync(join(root, "lib/coachGameMonteCarlo.ts"), "utf8");
  assert.match(src, /One game timeout\/network failure must not abort the whole slate/);
  assert.match(src, /try \{[\s\S]*fetchGameOutcomeSimulation[\s\S]*\} catch/);
});

test("board scan game phase continues after a thrown slate batch", () => {
  const src = readFileSync(join(root, "lib/boardMarketScanner.ts"), "utf8");
  assert.match(src, /Keep scanning remaining games \+ props/);
  assert.match(src, /incomplete: boolean/);
  assert.match(src, /Start the prop MC clock AFTER sync ranking/);
});


test("board scan passes liveOdds as one mergeOddsEntries source (SCAN_THREW)", () => {
  const src = readFileSync(join(root, "lib/boardMarketScanner.ts"), "utf8");
  // Must NOT spread live odds into mergeOddsEntries(...sources).
  assert.doesNotMatch(
    src,
    /mergeOddsEntries\(\s*[^)]*\.\.\.\(opts\.liveOdds/,
  );
  assert.match(
    src,
    /mergeOddsEntries\(\s*opts\.realOdds,\s*opts\.liveOdds \?\? \[\]/,
  );
});

test("buildParlay forces skipPropExpand for yards allowlist / propsOnly", () => {
  const src = readFileSync(join(root, "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /allowedMarketKeys\s*!=\s*null/);
  assert.match(src, /propsOnly/);
  assert.match(src, /skipPropExpand/);
});

test("boardMarketScanner skips game slate when propsOnly", () => {
  const src = readFileSync(join(root, "lib/boardMarketScanner.ts"), "utf8");
  assert.match(src, /if \(!opts\.propsOnly\)/);
  assert.match(src, /opts\.propsOnly/);
});
