/**
 * Locked-market shortfall copy is market-agnostic: labels come from
 * EXPLICIT_MARKET_LOCK_RULES via matchExplicitMarketLocks / lockedMarketLabelForAsk.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPLICIT_MARKET_LOCK_RULES,
  matchExplicitMarketLocks,
} from "./explicitMarketLock.ts";
import { parseCoachAskMarketConstraint } from "./coachAskMarketFilter.ts";
import {
  lockedMarketLabelForAsk,
  lockedMarketPickPhrase,
  lockedMarketQualityShortfallNote,
} from "./lockedMarketQualityShortfall.ts";

/** Representative asks across sports — only markets the parser already locks. */
const EXAMPLE_ASKS: ReadonlyArray<{
  ask: string;
  expectId: string;
  expectLabel: string;
  expectPhrase: string;
  legs: number;
}> = [
  {
    ask: "5 touchdown picks tonight",
    expectId: "fb_touchdowns",
    expectLabel: "touchdowns",
    expectPhrase: "touchdown picks",
    legs: 5,
  },
  {
    ask: "5 home run picks tonight",
    expectId: "mlb_home_runs",
    expectLabel: "home runs",
    expectPhrase: "home run picks",
    legs: 5,
  },
  {
    ask: "4 passing yards picks tonight",
    expectId: "fb_pass_yds",
    expectLabel: "passing yards",
    expectPhrase: "passing yards picks",
    legs: 4,
  },
  {
    ask: "4 rushing yards picks tonight",
    expectId: "fb_rush_yds",
    expectLabel: "rushing yards",
    expectPhrase: "rushing yards picks",
    legs: 4,
  },
  {
    ask: "4 receiving yards picks tonight",
    expectId: "fb_rec_yds",
    expectLabel: "receiving yards",
    expectPhrase: "receiving yards picks",
    legs: 4,
  },
  {
    ask: "3 receptions picks tonight",
    expectId: "fb_receptions",
    expectLabel: "receptions",
    expectPhrase: "reception picks",
    legs: 3,
  },
  // No dedicated passing-TD lock — TD token locks the touchdowns family.
  {
    ask: "3 passing TD picks tonight",
    expectId: "fb_touchdowns",
    expectLabel: "touchdowns",
    expectPhrase: "touchdown picks",
    legs: 3,
  },
  {
    ask: "3 interceptions picks tonight",
    expectId: "fb_pass_ints",
    expectLabel: "pass interceptions",
    expectPhrase: "pass interception picks",
    legs: 3,
  },
  {
    ask: "3 sacks picks tonight",
    expectId: "fb_sacks",
    expectLabel: "sacks",
    expectPhrase: "sack picks",
    legs: 3,
  },
  {
    ask: "4 assists picks tonight",
    expectId: "nba_assists",
    expectLabel: "assists",
    expectPhrase: "assist picks",
    legs: 4,
  },
  {
    ask: "4 rebounds picks tonight",
    expectId: "nba_rebounds",
    expectLabel: "rebounds",
    expectPhrase: "rebound picks",
    legs: 4,
  },
  {
    ask: "4 three pointers tonight",
    expectId: "nba_threes",
    expectLabel: "threes",
    expectPhrase: "threes picks",
    legs: 4,
  },
  {
    ask: "3 shots on goal tonight",
    expectId: "nhl_shots_on_goal",
    expectLabel: "shots on goal",
    expectPhrase: "shots on goal picks",
    legs: 3,
  },
  {
    ask: "5 strikeouts tonight",
    expectId: "mlb_strikeouts",
    expectLabel: "pitcher strikeouts",
    expectPhrase: "pitcher strikeout picks",
    legs: 5,
  },
  {
    ask: "4 stolen bases tonight",
    expectId: "mlb_stolen_bases",
    expectLabel: "stolen bases",
    expectPhrase: "stolen bases picks",
    legs: 4,
  },
  {
    ask: "3 shots on target tonight",
    expectId: "soccer_shots_on_target",
    expectLabel: "shots on target",
    expectPhrase: "shots on target picks",
    legs: 3,
  },
  {
    ask: "5 points props tonight",
    expectId: "nba_points",
    expectLabel: "points",
    expectPhrase: "points picks",
    legs: 5,
  },
];

test("lockedMarketPickPhrase keeps unit plurals and singularizes simple plurals", () => {
  assert.equal(lockedMarketPickPhrase("touchdowns"), "touchdown picks");
  assert.equal(lockedMarketPickPhrase("home runs"), "home run picks");
  assert.equal(lockedMarketPickPhrase("passing yards"), "passing yards picks");
  assert.equal(lockedMarketPickPhrase("rushing yards"), "rushing yards picks");
  assert.equal(lockedMarketPickPhrase("receiving yards"), "receiving yards picks");
  assert.equal(lockedMarketPickPhrase("stolen bases"), "stolen bases picks");
  assert.equal(lockedMarketPickPhrase("threes"), "threes picks");
  assert.equal(lockedMarketPickPhrase("pts+reb+ast"), "pts+reb+ast picks");
  assert.equal(lockedMarketPickPhrase("shots on goal"), "shots on goal picks");
  assert.equal(lockedMarketPickPhrase(""), "picks");
});

test("example asks resolve labels from canonical EXPLICIT_MARKET_LOCK_RULES", () => {
  for (const row of EXAMPLE_ASKS) {
    const matched = matchExplicitMarketLocks(row.ask);
    assert.ok(matched, `expected lock for: ${row.ask}`);
    assert.ok(
      matched!.ids.includes(row.expectId),
      `${row.ask} → ids ${matched!.ids.join(",")} missing ${row.expectId}`,
    );
    assert.equal(lockedMarketLabelForAsk(row.ask), row.expectLabel);
    assert.equal(lockedMarketPickPhrase(row.expectLabel), row.expectPhrase);

    const constraint = parseCoachAskMarketConstraint(row.ask);
    assert.equal(constraint.propsOnly, true, `${row.ask} should be props-only`);
    assert.ok(
      constraint.allowedMarketKeys && constraint.allowedMarketKeys.length > 0,
      `${row.ask} must keep an allowlist (market lock intact)`,
    );
  }
});

test("every EXPLICIT_MARKET_LOCK_RULES label is generic for 0/N, partial, N/N", () => {
  for (const rule of EXPLICIT_MARKET_LOCK_RULES) {
    const phrase = lockedMarketPickPhrase(rule.label);
    assert.match(phrase, /picks$/);

    // Only TD lock rules may mention touchdown/TD in the phrase — others must not.
    if (rule.id === "fb_touchdowns" || rule.id === "fb_first_td") {
      assert.match(phrase, /td|touchdown/i);
    } else {
      assert.doesNotMatch(
        phrase,
        /\btouchdown\b|\btd\b/i,
        `${rule.id} phrase leaked touchdown: ${phrase}`,
      );
    }

    const analyzed = 17;
    const requested = 6;
    const zero = lockedMarketQualityShortfallNote({
      requestedLegs: requested,
      analyzed,
      qualified: 0,
      marketLabel: rule.label,
    });
    assert.equal(
      zero,
      `I found and analyzed ${analyzed} ${phrase} for tonight, but none met Stadium Edge's quality standards. ` +
        `I won't add weaker picks just to fill your ${requested}-leg request.`,
      `0/N for ${rule.id}`,
    );

    const partialQ = 2;
    const partial = lockedMarketQualityShortfallNote({
      requestedLegs: requested,
      analyzed,
      qualified: partialQ,
      marketLabel: rule.label,
    });
    assert.equal(
      partial,
      `You asked for ${requested} ${phrase}. ` +
        `I found ${partialQ} that met Stadium Edge's quality standards, ` +
        `so I'm showing ${partialQ} instead of adding weaker picks.`,
      `partial for ${rule.id}`,
    );

    const full = lockedMarketQualityShortfallNote({
      requestedLegs: requested,
      analyzed,
      qualified: requested,
      marketLabel: rule.label,
    });
    assert.equal(full, "", `N/N for ${rule.id} must be empty (success path)`);
  }
});

test("parameterized example asks: 0/N, partial N/N, N/N + dynamic legs", () => {
  for (const row of EXAMPLE_ASKS) {
    const label = lockedMarketLabelForAsk(row.ask)!;
    const phrase = lockedMarketPickPhrase(label);
    assert.equal(phrase, row.expectPhrase);

    const analyzed = 39;
    const zero = lockedMarketQualityShortfallNote({
      requestedLegs: row.legs,
      analyzed,
      qualified: 0,
      marketLabel: label,
    });
    assert.equal(
      zero,
      `I found and analyzed ${analyzed} ${phrase} for tonight, but none met Stadium Edge's quality standards. ` +
        `I won't add weaker picks just to fill your ${row.legs}-leg request.`,
    );
    assert.doesNotMatch(zero, /recovery odds|staging|candidate pool|substituted/i);

    const q = Math.max(1, Math.min(row.legs - 1, 2));
    const partial = lockedMarketQualityShortfallNote({
      requestedLegs: row.legs,
      analyzed,
      qualified: q,
      marketLabel: label,
    });
    assert.equal(
      partial,
      `You asked for ${row.legs} ${phrase}. ` +
        `I found ${q} that met Stadium Edge's quality standards, ` +
        `so I'm showing ${q} instead of adding weaker picks.`,
    );

    assert.equal(
      lockedMarketQualityShortfallNote({
        requestedLegs: row.legs,
        analyzed,
        qualified: row.legs,
        marketLabel: label,
      }),
      "",
    );
  }

  // Dynamic 2–15 on a non-TD market.
  for (const n of [2, 7, 11, 15]) {
    const note = lockedMarketQualityShortfallNote({
      requestedLegs: n,
      analyzed: 10,
      qualified: 0,
      marketLabel: "passing yards",
    });
    assert.match(note, /passing yards picks/);
    assert.match(note, new RegExp(`${n}-leg request`));
    assert.doesNotMatch(note, /touchdown/i);
  }
});

test("generic N leg tonight stays unlocked — no locked-market wording", () => {
  for (const ask of ["5 leg tonight", "6 leg tonight", "10 legs tonight", "8 leg"]) {
    assert.equal(matchExplicitMarketLocks(ask), null, ask);
    assert.equal(lockedMarketLabelForAsk(ask), null, ask);
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, false, ask);
    assert.equal(c.allowedMarketKeys, null, ask);
  }
});

test("buildParlay wires lockedMarketLabelForAsk (canonical labels, not TD-only)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(root, "coach/buildParlay.ts"), "utf8");
  assert.match(src, /lockedMarketLabelForAsk/);
  assert.match(src, /lockedMarketQualityShortfallNote/);
  assert.doesNotMatch(src, /matchExplicitMarketLocks/);
  // Must not hard-code touchdown into the shortfall wiring.
  assert.doesNotMatch(
    src,
    /lockedMarketQualityShortfallNote\(\{[\s\S]*touchdown/i,
  );
});
