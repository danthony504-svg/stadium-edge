/**
 * Parser + sequential-state invariants for Coach QA.
 */

import { generateRequestMatrix, sequentialTransitionSeeds, type MatrixCase } from "./matrix.ts";
import { snapshotAsk } from "./parseSnapshot.ts";
import type { AskSnapshot, QaCaseResult, QaFinding } from "./types.ts";

let findingSeq = 0;
function finding(
  partial: Omit<QaFinding, "id"> & { id?: string },
): QaFinding {
  findingSeq += 1;
  return { id: partial.id ?? `F${findingSeq}`, ...partial } as QaFinding;
}

function tokensHit(haystacks: string[], needles: string[]): string[] {
  const hits: string[] = [];
  for (const n of needles) {
    const nl = n.toLowerCase();
    if (haystacks.some((h) => h.toLowerCase().includes(nl))) hits.push(n);
  }
  return hits;
}

/** Evaluate a single matrix case against documented expect hints + universal rules. */
export function checkParserInvariants(c: MatrixCase): QaCaseResult[] {
  const results: QaCaseResult[] = [];
  const snap = snapshotAsk(c.ask, []);
  const baseId = `parser:${c.id}`;

  const pass = (suffix: string, meta?: Record<string, unknown>): QaCaseResult => ({
    id: `${baseId}:${suffix}`,
    suite: "parser",
    ok: true,
    meta: { ask: c.ask, ...snap, ...meta },
  });

  const fail = (
    suffix: string,
    f: Omit<QaFinding, "id" | "promptOrSequence" | "productionAffected"> & {
      productionAffected?: boolean;
    },
  ): QaCaseResult => ({
    id: `${baseId}:${suffix}`,
    suite: "parser",
    ok: false,
    finding: finding({
      ...f,
      promptOrSequence: c.ask,
      productionAffected: f.productionAffected ?? true,
    }),
  });

  // Universal: requested legs when N-leg phrasing present
  if (/\b\d{1,3}\s*[-\s]?\s*l(?:eg|ag)s?\b/i.test(c.ask) || c.expect?.legs) {
    const expectLegs = c.expect?.legs;
    if (expectLegs != null && snap.requestedLegs !== expectLegs) {
      results.push(
        fail("legs", {
          severity: "P1",
          category: "parser",
          title: "requestedLegs mismatch",
          expected: `requestedLegs=${expectLegs}`,
          actual: `requestedLegs=${snap.requestedLegs}`,
          stage: "parseRequestedLegs",
          likelyFile: "lib/coach/parseAsk.ts",
        }),
      );
    } else {
      results.push(pass("legs"));
    }
  }

  // Bare generic must not be market-locked or props-only
  if (c.expect?.bareGenericMix || /^(\d{1,3})\s*[-\s]?\s*legs?$/i.test(c.ask.trim())) {
    if (snap.isMarketLocked) {
      results.push(
        fail("bare-lock", {
          severity: "P1",
          category: "parser",
          title: "Bare N-leg became market-locked",
          expected: "isMarketLocked=false, allowedMarketKeys=null",
          actual: `isMarketLocked=true keys=${JSON.stringify(snap.allowedMarketKeys)}`,
          stage: "parseCoachAskMarketConstraint",
          likelyFile: "lib/coachAskMarketFilter.ts",
        }),
      );
    } else if (snap.propsOnly) {
      results.push(
        fail("bare-props", {
          severity: "P1",
          category: "parser",
          title: "Bare N-leg became propsOnly",
          expected: "propsOnly=false, path=full_board_mix",
          actual: `propsOnly=true path=${snap.pathHint}`,
          stage: "parseCoachAskMarketConstraint",
          likelyFile: "lib/slate.ts#wantsPropsOnly / threadWantsPropsOnly",
        }),
      );
    } else {
      results.push(pass("bare-mix"));
    }
  }

  if (c.expect?.propsOnly === true && !snap.propsOnly) {
    results.push(
      fail("propsOnly-missing", {
        severity: "P1",
        category: "parser",
        title: "Expected propsOnly",
        expected: "propsOnly=true",
        actual: "propsOnly=false",
        stage: "parseCoachAskMarketConstraint",
        likelyFile: "lib/coachAskMarketFilter.ts",
      }),
    );
  } else if (c.expect?.propsOnly === false && snap.propsOnly) {
    results.push(
      fail("propsOnly-unexpected", {
        severity: "P1",
        category: "parser",
        title: "Unexpected propsOnly",
        expected: "propsOnly=false",
        actual: "propsOnly=true",
        stage: "parseCoachAskMarketConstraint",
        likelyFile: "lib/slate.ts",
      }),
    );
  } else if (c.expect?.propsOnly != null) {
    results.push(pass("propsOnly"));
  }

  if (c.expect?.marketLocked === true) {
    if (!snap.isMarketLocked) {
      results.push(
        fail("lock-missing", {
          severity: "P1",
          category: "parser",
          title: "Expected market lock missing",
          expected: "isMarketLocked=true",
          actual: `isMarketLocked=false family=${snap.marketFamilyLabel}`,
          stage: "parseCoachAskMarketConstraint",
          likelyFile: "lib/explicitMarketLock.ts",
        }),
      );
    } else if (
      c.expect.marketFamilyIncludes &&
      !(snap.allowedMarketKeys ?? []).some(
        (k) =>
          k === c.expect!.marketFamilyIncludes ||
          k.startsWith(c.expect!.marketFamilyIncludes!),
      )
    ) {
      results.push(
        fail("lock-family", {
          severity: "P1",
          category: "date_sport_team",
          title: "Market lock family mismatch",
          expected: `keys include ${c.expect.marketFamilyIncludes}`,
          actual: `keys=${JSON.stringify(snap.allowedMarketKeys)}`,
          stage: "allowedMarketKeys",
          likelyFile: "lib/explicitMarketLock.ts",
        }),
      );
    } else {
      results.push(pass("market-lock"));
    }
  }

  if (c.expect?.marketLocked === false && snap.isMarketLocked) {
    results.push(
      fail("lock-unexpected", {
        severity: "P1",
        category: "parser",
        title: "Unexpected market lock",
        expected: "isMarketLocked=false",
        actual: `keys=${JSON.stringify(snap.allowedMarketKeys)}`,
        stage: "parseCoachAskMarketConstraint",
        likelyFile: "lib/coachAskMarketFilter.ts",
      }),
    );
  }

  // Sport focus when explicit sport named
  if (c.expect?.sport) {
    const sp = c.expect.sport.toLowerCase();
    if (!snap.focalSports.includes(sp) && !snap.boardSports.includes(sp)) {
      results.push(
        fail("sport", {
          severity: "P1",
          category: "date_sport_team",
          title: "Sport not scoped",
          expected: `focal/board includes ${sp}`,
          actual: `focal=${snap.focalSports} board=${snap.boardSports.slice(0, 8)}…`,
          stage: "focalSportsFromText / coachBoardSportsForAsk",
          likelyFile: "lib/chatContextPriority.ts",
        }),
      );
    } else {
      results.push(pass("sport"));
    }
  }

  if (c.expect?.sport === null && snap.focalSports.length > 0) {
    // Generic asks should not hard-focus a sport
    results.push(
      fail("sport-leak-generic", {
        severity: "P2",
        category: "date_sport_team",
        title: "Generic ask unexpectedly focal-scoped",
        expected: "focalSports=[]",
        actual: `focalSports=${JSON.stringify(snap.focalSports)}`,
        stage: "focalSportsFromText",
        likelyFile: "lib/chatContextPriority.ts",
      }),
    );
  } else if (c.expect?.sport === null) {
    results.push(pass("generic-sport"));
  }

  // Exclusion must not become positive teamScope
  if (c.expect?.noPositiveTeamTokens?.length) {
    const includeTokens = snap.teamScope?.matchTokens ?? [];
    const bad = tokensHit(includeTokens, c.expect.noPositiveTeamTokens);
    if (bad.length) {
      results.push(
        fail("exclude-as-include", {
          severity: "P0",
          category: "date_sport_team",
          title: "Excluded team became positive teamScope",
          expected: `teamScope must not include ${c.expect.noPositiveTeamTokens.join(",")}`,
          actual: `teamScope.tokens=${JSON.stringify(includeTokens)}`,
          stage: "coachAskTeamScope",
          likelyFile: "lib/coachAskTeamScope.ts",
        }),
      );
    } else {
      results.push(pass("exclude-not-include"));
    }
  }

  if (c.expect?.hasExcludedTokens?.length) {
    const exTokens = snap.excludedTeams.flatMap((e) => e.matchTokens);
    const missing = c.expect.hasExcludedTokens.filter(
      (n) => !exTokens.some((t) => t.includes(n.toLowerCase()) || n.toLowerCase().includes(t)),
    );
    if (missing.length) {
      results.push(
        fail("exclude-missing", {
          severity: "P1",
          category: "date_sport_team",
          title: "Expected team exclusion missing",
          expected: `excluded contains ${c.expect.hasExcludedTokens.join(",")}`,
          actual: `excluded=${JSON.stringify(exTokens)}`,
          stage: "excludedTeamScopesFromText",
          likelyFile: "lib/coachAskTeamScope.ts",
        }),
      );
    } else {
      results.push(pass("exclude-present"));
    }
  }

  if (c.expect?.slateDay !== undefined) {
    if (snap.slateDay !== c.expect.slateDay) {
      results.push(
        fail("slate", {
          severity: "P1",
          category: "date_sport_team",
          title: "Slate day mismatch",
          expected: `slateDay=${c.expect.slateDay}`,
          actual: `slateDay=${snap.slateDay}`,
          stage: "slateDayFromThread",
          likelyFile: "lib/slate.ts",
        }),
      );
    } else {
      results.push(pass("slate"));
    }
  }

  if (results.length === 0) results.push(pass("ok"));
  return results;
}

function isBareNLeg(ask: string): boolean {
  return /^\d{1,3}\s*[-\s]?\s*l(?:eg|ag)s?$/i.test(ask.trim());
}

function hasDateCue(ask: string): boolean {
  return /\b(tonight|today|tomorrow)\b/i.test(ask);
}

/**
 * Sequential torture: second ask must not inherit stale constraints unless
 * product-documented (slate-day inheritance when current has no date cue).
 *
 * Bare "N leg" after a props-only / market-locked prior MUST reset to generic mix
 * (production screenshot regression: 4 leg soccer → 5 leg).
 */
export function checkSequentialTransition(
  id: string,
  first: string,
  second: string,
  mustReset: string[],
  seed?: number,
): QaCaseResult[] {
  const a = snapshotAsk(first, []);
  const b = snapshotAsk(second, [first]);
  const results: QaCaseResult[] = [];
  const seq = [first, second];

  const fail = (
    suffix: string,
    f: Omit<QaFinding, "id" | "promptOrSequence" | "productionAffected">,
  ): QaCaseResult => ({
    id: `seq:${id}:${suffix}`,
    suite: "sequential",
    ok: false,
    finding: finding({
      ...f,
      promptOrSequence: seq,
      seed,
      productionAffected: true,
    }),
  });

  const pass = (suffix: string): QaCaseResult => ({
    id: `seq:${id}:${suffix}`,
    suite: "sequential",
    ok: true,
    meta: { first: a, second: b },
  });

  if (mustReset.includes("legs")) {
    const expectLegs = snapshotAsk(second, []).requestedLegs;
    if (b.requestedLegs !== expectLegs) {
      results.push(
        fail("legs", {
          severity: "P1",
          category: "state_leak",
          title: "Leg count leaked or misparsed on follow-up",
          expected: `requestedLegs=${expectLegs}`,
          actual: `requestedLegs=${b.requestedLegs}`,
          stage: "parseRequestedLegs",
          likelyFile: "lib/coach/parseAsk.ts",
        }),
      );
    } else results.push(pass("legs"));
  }

  if (mustReset.includes("marketLock")) {
    // Second ask alone
    const alone = snapshotAsk(second, []);
    if (b.isMarketLocked && !alone.isMarketLocked) {
      results.push(
        fail("marketLock", {
          severity: "P1",
          category: "state_leak",
          title: "Market lock leaked from prior turn",
          expected: "isMarketLocked=false (from current text)",
          actual: `isMarketLocked=true keys=${JSON.stringify(b.allowedMarketKeys)}`,
          stage: "parseCoachAskMarketConstraint+priorUserTexts",
          likelyFile: "lib/coachAskMarketFilter.ts",
        }),
      );
    } else if (
      alone.isMarketLocked &&
      JSON.stringify(alone.allowedMarketKeys) !== JSON.stringify(b.allowedMarketKeys)
    ) {
      results.push(
        fail("marketLock-mutate", {
          severity: "P1",
          category: "state_leak",
          title: "Market allowlist mutated by priors",
          expected: JSON.stringify(alone.allowedMarketKeys),
          actual: JSON.stringify(b.allowedMarketKeys),
          stage: "allowedMarketKeys",
          likelyFile: "lib/coachAskMarketFilter.ts",
        }),
      );
    } else results.push(pass("marketLock"));
  }

  if (mustReset.includes("propsOnly")) {
    const alone = snapshotAsk(second, []);
    // Bare N-leg or ask that alone is not props-only must not inherit.
    if (!alone.propsOnly && b.propsOnly) {
      results.push(
        fail("propsOnly", {
          severity: "P1",
          category: "state_leak",
          title: "propsOnly leaked from prior turn onto follow-up",
          expected: "propsOnly=false (current text alone)",
          actual: `propsOnly=true via threadWantsPropsOnly priors=[${first}]`,
          stage: "threadWantsPropsOnly",
          likelyFile: "lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts",
        }),
      );
    } else if (isBareNLeg(second) && b.propsOnly) {
      results.push(
        fail("propsOnly-bare", {
          severity: "P1",
          category: "state_leak",
          title: "Bare N-leg follow-up stayed propsOnly",
          expected: "bare N-leg → full_board_mix",
          actual: `propsOnly=true path=${b.pathHint}`,
          stage: "threadWantsPropsOnly",
          likelyFile: "lib/slate.ts#threadWantsPropsOnly",
        }),
      );
    } else results.push(pass("propsOnly"));
  }

  if (mustReset.includes("sport")) {
    const alone = snapshotAsk(second, []);
    const leaked = b.focalSports.filter((s) => !alone.focalSports.includes(s));
    // Sport focus should come from current text only (focalSportsFromText).
    if (leaked.length && alone.focalSports.length === 0) {
      results.push(
        fail("sport", {
          severity: "P1",
          category: "state_leak",
          title: "Sport focus leaked onto follow-up",
          expected: `focalSports=${JSON.stringify(alone.focalSports)}`,
          actual: `focalSports=${JSON.stringify(b.focalSports)}`,
          stage: "focalSportsFromText",
          likelyFile: "lib/chatContextPriority.ts",
        }),
      );
    } else results.push(pass("sport"));
  }

  if (mustReset.includes("teamInclude")) {
    const alone = snapshotAsk(second, []);
    if (!alone.teamScope && b.teamScope) {
      results.push(
        fail("teamInclude", {
          severity: "P1",
          category: "state_leak",
          title: "Team inclusion leaked from prior turn",
          expected: "teamScope=null",
          actual: JSON.stringify(b.teamScope),
          stage: "coachAskTeamScope",
          likelyFile: "lib/coachAskTeamScope.ts",
        }),
      );
    } else results.push(pass("teamInclude"));
  }

  if (mustReset.includes("teamExclude")) {
    const alone = snapshotAsk(second, []);
    if (alone.excludedTeams.length === 0 && b.excludedTeams.length > 0) {
      results.push(
        fail("teamExclude", {
          severity: "P1",
          category: "state_leak",
          title: "Team exclusion leaked from prior turn",
          expected: "excludedTeams=[]",
          actual: JSON.stringify(b.excludedTeams),
          stage: "excludedTeamScopesFromText",
          likelyFile: "lib/coachAskTeamScope.ts",
        }),
      );
    } else results.push(pass("teamExclude"));
  }

  if (mustReset.includes("slateDay")) {
    // Explicit date on THIS turn must win.
    if (hasDateCue(second)) {
      const alone = snapshotAsk(second, []);
      if (b.slateDay !== alone.slateDay) {
        results.push(
          fail("slateDay", {
            severity: "P1",
            category: "state_leak",
            title: "Explicit date on follow-up lost to prior",
            expected: `slateDay=${alone.slateDay}`,
            actual: `slateDay=${b.slateDay}`,
            stage: "slateDayFromThread",
            likelyFile: "lib/slate.ts",
          }),
        );
      } else results.push(pass("slateDay"));
    } else {
      results.push(pass("slateDay-inherit-ok"));
    }
  }

  // Always assert market allowlist never inherits when second alone unlocked
  {
    const alone = snapshotAsk(second, []);
    if (!alone.isMarketLocked && b.isMarketLocked) {
      results.push(
        fail("allowlist-inherit", {
          severity: "P0",
          category: "state_leak",
          title: "allowedMarketKeys inherited across turns",
          expected: "allowedMarketKeys=null",
          actual: JSON.stringify(b.allowedMarketKeys),
          stage: "parseCoachAskMarketConstraint",
          likelyFile: "lib/coachAskMarketFilter.ts",
        }),
      );
    }
  }

  if (results.length === 0) results.push(pass("ok"));
  return results;
}

export function runParserMatrixSuite(): QaCaseResult[] {
  const matrix = generateRequestMatrix();
  const out: QaCaseResult[] = [];
  for (const c of matrix) {
    out.push(...checkParserInvariants(c));
  }
  return out;
}

export function runSequentialSeedSuite(): QaCaseResult[] {
  const out: QaCaseResult[] = [];
  for (const t of sequentialTransitionSeeds()) {
    out.push(
      ...checkSequentialTransition(t.id, t.first, t.second, t.mustReset),
    );
  }
  return out;
}

export function describeSnapshot(s: AskSnapshot): string {
  return JSON.stringify({
    legs: s.requestedLegs,
    focal: s.focalSports,
    slate: s.slateDay,
    propsOnly: s.propsOnly,
    gameLinesOnly: s.gameLinesOnly,
    locked: s.isMarketLocked,
    keys: s.allowedMarketKeys,
    family: s.marketFamilyLabel,
    team: s.teamScope,
    excluded: s.excludedTeams,
    path: s.pathHint,
  });
}
