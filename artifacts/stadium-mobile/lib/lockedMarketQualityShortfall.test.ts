import assert from "node:assert/strict";
import test from "node:test";
import {
  lockedMarketPickPhrase,
  lockedMarketQualityShortfallNote,
} from "./lockedMarketQualityShortfall.ts";

test("lockedMarketPickPhrase singularizes for pick noun", () => {
  assert.equal(lockedMarketPickPhrase("touchdowns"), "touchdown picks");
  assert.equal(lockedMarketPickPhrase("home runs"), "home run picks");
  assert.equal(lockedMarketPickPhrase("rushing yards"), "rushing yard picks");
  assert.equal(lockedMarketPickPhrase("first TD"), "first TD picks");
  assert.equal(lockedMarketPickPhrase(""), "picks");
});

test("0/N locked-market shortfall — no internal gate jargon", () => {
  const note = lockedMarketQualityShortfallNote({
    requestedLegs: 5,
    analyzed: 39,
    qualified: 0,
    marketLabel: "touchdowns",
  });
  assert.equal(
    note,
    "I found and analyzed 39 touchdown picks for tonight, but none met Stadium Edge's quality standards. I won't add weaker picks just to fill your 5-leg request.",
  );
  assert.doesNotMatch(note, /recovery odds|staging|candidate pool|quality bar|substituted/i);
});

test("partial N/N locked-market shortfall uses real counts", () => {
  const note = lockedMarketQualityShortfallNote({
    requestedLegs: 5,
    analyzed: 39,
    qualified: 2,
    marketLabel: "touchdowns",
  });
  assert.equal(
    note,
    "You asked for 5 touchdown picks. I found 2 that met Stadium Edge's quality standards, so I'm showing 2 instead of adding weaker picks.",
  );
  assert.doesNotMatch(note, /recovery odds|staging|candidate pool|substituted/i);
});

test("dynamic leg counts 2–15 and analyzed/qualified", () => {
  const zero = lockedMarketQualityShortfallNote({
    requestedLegs: 12,
    analyzed: 7,
    qualified: 0,
    marketLabel: "home runs",
  });
  assert.match(zero, /analyzed 7 home run picks/);
  assert.match(zero, /12-leg request/);

  const partial = lockedMarketQualityShortfallNote({
    requestedLegs: 8,
    analyzed: 40,
    qualified: 3,
    marketLabel: "rushing yards",
  });
  assert.match(partial, /asked for 8 rushing yard picks/);
  assert.match(partial, /found 3 that met/);
  assert.match(partial, /showing 3 instead/);
});

test("no shortfall note when nothing analyzed or fully filled", () => {
  assert.equal(
    lockedMarketQualityShortfallNote({
      requestedLegs: 5,
      analyzed: 0,
      qualified: 0,
      marketLabel: "touchdowns",
    }),
    "",
  );
  assert.equal(
    lockedMarketQualityShortfallNote({
      requestedLegs: 5,
      analyzed: 20,
      qualified: 5,
      marketLabel: "touchdowns",
    }),
    "",
  );
});
