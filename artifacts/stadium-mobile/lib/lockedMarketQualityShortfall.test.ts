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
import { parseCoachAskMarketConstraint, filterPropPoolByAskMarkets, propMarketKeyAllowed } from "./coachAskMarketFilter.ts";
import { filterHrScorerPoolEntries, isBatterHomeRunMarket } from "./coachHrRank.ts";
import {
  lockedMarketAnalyzedFromBoardDiagnostics,
  lockedMarketLabelForAsk,
  lockedMarketPickPhrase,
  lockedMarketQualityShortfallNote,
  resolveCoachParlayShortfallLead,
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

test("every EXPLICIT_MARKET_LOCK_RULES label: analyzed=0, 0/N, partial, N/N", () => {
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

    const requested = 6;
    const zeroAnalyzed = lockedMarketQualityShortfallNote({
      requestedLegs: requested,
      analyzed: 0,
      qualified: 0,
      marketLabel: rule.label,
    });
    assert.equal(
      zeroAnalyzed,
      `I couldn't find any available ${phrase} for tonight that I could grade. ` +
        `I won't substitute another market just to fill your ${requested}-leg request.`,
      `analyzed=0 for ${rule.id}`,
    );
    assert.doesNotMatch(zeroAnalyzed, /found and analyzed/i);

    const analyzed = 17;
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

test("parameterized example asks: analyzed=0, 0/N, partial, N/N + dynamic legs", () => {
  for (const row of EXAMPLE_ASKS) {
    const label = lockedMarketLabelForAsk(row.ask)!;
    const phrase = lockedMarketPickPhrase(label);
    assert.equal(phrase, row.expectPhrase);

    const none = lockedMarketQualityShortfallNote({
      requestedLegs: row.legs,
      analyzed: 0,
      qualified: 0,
      marketLabel: label,
    });
    assert.equal(
      none,
      `I couldn't find any available ${phrase} for tonight that I could grade. ` +
        `I won't substitute another market just to fill your ${row.legs}-leg request.`,
    );

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
    assert.doesNotMatch(zero, /\*\*/);

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
    assert.doesNotMatch(note, /\*\*/);
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

test("buildParlay wires resolveCoachParlayShortfallLead on both exits (canonical labels)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(root, "coach/buildParlay.ts"), "utf8");
  assert.match(src, /lockedMarketLabelForAsk/);
  assert.match(src, /lockedMarketQualityShortfallNote/);
  assert.match(src, /resolveCoachParlayShortfallLead/);
  assert.doesNotMatch(src, /matchExplicitMarketLocks/);
  // Must not hard-code touchdown into the shortfall wiring.
  assert.doesNotMatch(
    src,
    /lockedMarketQualityShortfallNote\(\{[\s\S]*touchdown/i,
  );
  // HR still uses dedicated full-board path — do not fold into props-only.
  assert.match(src, /!hrBoardAsk/);
  assert.match(src, /exhaustPropBoard:\s*hrBoardAsk/);
  // Full-board exit must pass real diagnostics propLegsScored (not invent).
  assert.match(src, /lockedMarketAnalyzedFromBoardDiagnostics/);
  assert.match(src, /failureDiagnostics/);
});

/**
 * Simulates the final shortfall lead each buildParlay exit constructs — the
 * same resolveCoachParlayShortfallLead call both paths share after the fix.
 */
test("buildParlay path shortfall: TD props-only vs HR full-board vs generic", () => {
  const tdAsk = "5 leg touchdown";
  const hrAsk = "5 home run picks tonight";
  const genericAsk = "5 leg tonight";

  const tdConstraint = parseCoachAskMarketConstraint(tdAsk);
  const hrConstraint = parseCoachAskMarketConstraint(hrAsk);
  const genericConstraint = parseCoachAskMarketConstraint(genericAsk);

  assert.equal(tdConstraint.propsOnly, true);
  assert.ok(tdConstraint.allowedMarketKeys?.length);
  const tdHrBoardAsk =
    tdConstraint.propsOnly &&
    (tdConstraint.allowedMarketKeys ?? []).some((k) => isBatterHomeRunMarket(k));
  assert.equal(tdHrBoardAsk, false, "TD must stay on props-only path");

  assert.equal(hrConstraint.propsOnly, true);
  assert.deepEqual(hrConstraint.allowedMarketKeys, ["batter_home_runs"]);
  const hrBoardAsk =
    hrConstraint.propsOnly &&
    (hrConstraint.allowedMarketKeys ?? []).some((k) => isBatterHomeRunMarket(k));
  assert.equal(hrBoardAsk, true, "HR must stay on full-board / hrBoardAsk path");

  assert.equal(genericConstraint.propsOnly, false);
  assert.equal(genericConstraint.allowedMarketKeys, null);

  // TD props-only/recovery empty: analyzed=39, qualified=0
  const tdNote = resolveCoachParlayShortfallLead({
    askText: tdAsk,
    requestedLegs: 5,
    qualified: 0,
    analyzed: 39,
    isMarketLocked: true,
  });
  assert.equal(
    tdNote,
    "I found and analyzed 39 touchdown picks for tonight, but none met Stadium Edge's quality standards. I won't add weaker picks just to fill your 5-leg request.",
  );

  // HR full-board empty with graded candidates
  const hrAnalyzed = resolveCoachParlayShortfallLead({
    askText: hrAsk,
    requestedLegs: 5,
    qualified: 0,
    analyzed: 22,
    isMarketLocked: true,
  });
  assert.equal(
    hrAnalyzed,
    "I found and analyzed 22 home run picks for tonight, but none met Stadium Edge's quality standards. I won't add weaker picks just to fill your 5-leg request.",
  );

  // HR full-board empty with 0 graded (diagnostics propLegsScored=0)
  const hrZero = resolveCoachParlayShortfallLead({
    askText: hrAsk,
    requestedLegs: 5,
    qualified: 0,
    analyzed: 0,
    isMarketLocked: true,
  });
  assert.equal(
    hrZero,
    "I couldn't find any available home run picks for tonight that I could grade. I won't substitute another market just to fill your 5-leg request.",
  );
  assert.doesNotMatch(hrZero, /found and analyzed/i);

  // HR partial
  const hrPartial = resolveCoachParlayShortfallLead({
    askText: hrAsk,
    requestedLegs: 5,
    qualified: 2,
    analyzed: 22,
    isMarketLocked: true,
  });
  assert.equal(
    hrPartial,
    "You asked for 5 home run picks. I found 2 that met Stadium Edge's quality standards, so I'm showing 2 instead of adding weaker picks.",
  );

  // HR N/N
  assert.equal(
    resolveCoachParlayShortfallLead({
      askText: hrAsk,
      requestedLegs: 5,
      qualified: 5,
      analyzed: 22,
      isMarketLocked: true,
    }),
    "",
  );

  // Other explicit lock families (full-board or props-only — same resolver)
  for (const ask of [
    "5 passing yards picks tonight",
    "5 rushing yards picks tonight",
    "5 receiving yards picks tonight",
    "5 sacks picks tonight",
    "5 assists picks tonight",
    "5 rebounds picks tonight",
    "5 three pointers tonight",
    "5 shots on goal tonight",
  ]) {
    const note = resolveCoachParlayShortfallLead({
      askText: ask,
      requestedLegs: 5,
      qualified: 0,
      analyzed: 11,
      isMarketLocked: true,
    });
    assert.match(note, /I found and analyzed 11 .+ picks for tonight/);
    assert.match(note, /5-leg request/);
    assert.doesNotMatch(note, /You asked for \*\*|AI-backed picks cleared the quality bar/);
    assert.doesNotMatch(note, /\*\*/);
  }

  // Generic mixed ticket — never market-specific
  const generic = resolveCoachParlayShortfallLead({
    askText: genericAsk,
    requestedLegs: 5,
    qualified: 0,
    analyzed: 0,
    isMarketLocked: false,
  });
  assert.equal(
    generic,
    "You asked for 5 legs — no AI-backed picks cleared the quality bar. No ungraded filler was added.",
  );
  assert.match(generic, /\b5\b/);
  assert.doesNotMatch(generic, /\*\*/);
  assert.doesNotMatch(generic, /home run|touchdown|analyzed/i);

  // Dynamic 2–15 generic
  for (const n of [2, 3, 7, 10, 15]) {
    const g = resolveCoachParlayShortfallLead({
      askText: `${n} leg tonight`,
      requestedLegs: n,
      qualified: 0,
      analyzed: 0,
      isMarketLocked: false,
    });
    assert.match(g, new RegExp(`You asked for ${n} legs`));
    assert.doesNotMatch(g, /\*\*/);
  }
});

/**
 * Prove failureDiagnostics.propLegsScored is lock-scoped for explicit locks:
 * buildParlay filters the pool BEFORE scan, skips expand, then the scanner's
 * propLegsScored counts only isProp legs graded from that pool.
 */
test("analyzed count source is lock-scoped (HR excludes hits/TB/Ks; other locks equivalent)", () => {
  const mixedBoard = [
    { marketKey: "batter_home_runs", side: "Over" },
    { marketKey: "batter_home_runs_alternate", side: "Yes" },
    { marketKey: "batter_home_runs", side: "Under" },
    { marketKey: "batter_hits", side: "Over" },
    { marketKey: "batter_total_bases", side: "Over" },
    { marketKey: "pitcher_strikeouts", side: "Over" },
    { marketKey: "batter_rbis", side: "Over" },
    { marketKey: "player_anytime_td", side: "Yes" },
    { marketKey: "player_pass_yds", side: "Over" },
    { marketKey: "player_rush_yds", side: "Over" },
    { marketKey: "player_reception_yds", side: "Over" },
    { marketKey: "player_sacks", side: "Over" },
    { marketKey: "player_assists", side: "Over" },
    { marketKey: "player_rebounds", side: "Over" },
    { marketKey: "player_threes", side: "Over" },
    { marketKey: "player_shots_on_goal", side: "Over" },
  ];

  const cases: ReadonlyArray<{
    ask: string;
    expectKeys: readonly string[];
    hrBoardAsk: boolean;
    banned: RegExp;
  }> = [
    {
      ask: "5 home run picks tonight",
      expectKeys: ["batter_home_runs", "batter_home_runs_alternate"],
      hrBoardAsk: true,
      banned: /hits|total_bases|strikeouts|rbis|anytime_td|pass_yds|assists|shots_on_goal/,
    },
    {
      ask: "5 leg touchdown",
      expectKeys: [
        "player_anytime_td",
        "player_first_td",
        "player_rush_tds",
        "player_reception_tds",
        "player_pass_tds",
      ],
      hrBoardAsk: false,
      banned: /home_runs|hits|pass_yds|assists/,
    },
    {
      ask: "5 passing yards picks tonight",
      expectKeys: ["player_pass_yds"],
      hrBoardAsk: false,
      banned: /rush_yds|reception_yds|home_runs|assists/,
    },
    {
      ask: "5 rushing yards picks tonight",
      expectKeys: ["player_rush_yds"],
      hrBoardAsk: false,
      banned: /pass_yds|reception_yds|home_runs/,
    },
    {
      ask: "5 receiving yards picks tonight",
      expectKeys: ["player_reception_yds"],
      hrBoardAsk: false,
      banned: /pass_yds|rush_yds|home_runs/,
    },
    {
      ask: "5 sacks picks tonight",
      expectKeys: ["player_sacks"],
      hrBoardAsk: false,
      banned: /home_runs|assists|pass_yds/,
    },
    {
      ask: "5 assists picks tonight",
      expectKeys: ["player_assists"],
      hrBoardAsk: false,
      banned: /rebounds|threes|home_runs/,
    },
    {
      ask: "5 rebounds picks tonight",
      expectKeys: ["player_rebounds"],
      hrBoardAsk: false,
      banned: /assists|threes|home_runs/,
    },
    {
      ask: "5 three pointers tonight",
      expectKeys: ["player_threes"],
      hrBoardAsk: false,
      banned: /assists|rebounds|home_runs/,
    },
    {
      ask: "5 shots on goal tonight",
      expectKeys: ["player_shots_on_goal"],
      hrBoardAsk: false,
      banned: /home_runs|assists|pass_yds/,
    },
  ];

  for (const row of cases) {
    const c = parseCoachAskMarketConstraint(row.ask);
    assert.equal(c.propsOnly, true, row.ask);
    assert.ok(c.allowedMarketKeys?.length, row.ask);
    for (const k of row.expectKeys) {
      // allowlist may be the base key only; alts allowed via canonical match
      if (!k.endsWith("_alternate")) {
        assert.ok(
          c.allowedMarketKeys!.includes(k) ||
            c.allowedMarketKeys!.some((a) => k.startsWith(a)),
          `${row.ask} missing ${k}`,
        );
      }
    }

    const filtered = filterPropPoolByAskMarkets(mixedBoard, c.allowedMarketKeys);
    const hrBoardAsk =
      c.propsOnly &&
      (c.allowedMarketKeys ?? []).some((k) => isBatterHomeRunMarket(k));
    assert.equal(hrBoardAsk, row.hrBoardAsk, row.ask);
    const active = hrBoardAsk ? filterHrScorerPoolEntries(filtered) : filtered;

    // skipPropExpand equivalent: propsOnly || allowedMarketKeys
    const skipExpand = c.propsOnly || c.allowedMarketKeys != null;
    assert.equal(skipExpand, true, `${row.ask} must skip full-board expand`);

    for (const rowKey of active.map((r) => r.marketKey)) {
      assert.doesNotMatch(rowKey, row.banned, `${row.ask} leaked ${rowKey}`);
      assert.ok(
        propMarketKeyAllowed(rowKey, c.allowedMarketKeys),
        `${row.ask} active pool key ${rowKey} outside allowlist`,
      );
    }

    // Simulate scanner diagnostic: only graded props from the allowlisted pool.
    const gradedFromPool = active.filter((r) => {
      const side = String(r.side ?? "").toLowerCase();
      return side !== "under" && side !== "no";
    });
    // For HR, Under already removed by filterHrScorerPoolEntries.
    const propLegsScored = gradedFromPool.length;
    const analyzed = lockedMarketAnalyzedFromBoardDiagnostics({ propLegsScored });
    assert.equal(analyzed, propLegsScored, row.ask);
    // Must never equal the mixed board size (would prove cross-market leakage).
    assert.ok(analyzed < mixedBoard.length, `${row.ask} analyzed must be < mixed board`);

    if (row.ask.includes("home run")) {
      assert.equal(analyzed, 2, "HR: Over + alternate Yes only (Under dropped)");
      const note = resolveCoachParlayShortfallLead({
        askText: row.ask,
        requestedLegs: 5,
        qualified: 0,
        analyzed,
        isMarketLocked: true,
      });
      assert.match(note, /analyzed 2 home run picks/);
      assert.doesNotMatch(note, /hits|strikeouts|total bases/i);
    }
  }

  // Generics stay unlocked and would keep the full mixed pool (not lock-scoped).
  for (const ask of ["2 leg tonight", "5 leg tonight", "12 leg tonight"]) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly, false, ask);
    assert.equal(c.allowedMarketKeys, null, ask);
    const pool = filterPropPoolByAskMarkets(mixedBoard, c.allowedMarketKeys);
    assert.equal(pool.length, mixedBoard.length, ask);
    const note = resolveCoachParlayShortfallLead({
      askText: ask,
      requestedLegs: parseInt(ask, 10),
      qualified: 0,
      analyzed: 0,
      isMarketLocked: false,
    });
    assert.match(note, /You asked for \d+ legs/);
    assert.doesNotMatch(note, /home run|touchdown|analyzed/i);
    assert.doesNotMatch(note, /\*\*/);
  }
});
