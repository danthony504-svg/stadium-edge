import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  checkPropProviderProvenance,
  enforceSeatedPropProviderProvenance,
  hasCompletePropProviderProvenance,
  providerOutcomeKey,
  UNVERIFIED_RELEASE_EVIDENCE_PROPS,
} from "./propProviderProvenance.ts";

function prop(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "Tampa Bay Buccaneers @ Dallas Cowboys",
    market: "Sacks",
    pick: "Rueben Bain Jr. Under 0.25 Sacks",
    odds: -145,
    isProp: true,
    player: "Rueben Bain Jr.",
    athleteId: "4870617",
    propMarketKey: "player_sacks",
    propLine: 0.25,
    propSide: "Under",
    eventId: "259b5df9aa0d10257f56de78523495e0",
    sportsbook: "DraftKings",
    ...overrides,
  };
}

test("complete provenance accepts a fully evidenced Under side", () => {
  const p = prop();
  const check = checkPropProviderProvenance(p);
  assert.equal(check.ok, true);
  assert.deepEqual(check.missing, []);
  assert.equal(
    check.providerOutcomeKey,
    providerOutcomeKey({
      eventId: "259b5df9aa0d10257f56de78523495e0",
      propMarketKey: "player_sacks",
      athleteId: "4870617",
      propSide: "Under",
      propLine: 0.25,
      odds: -145,
      sportsbook: "DraftKings",
    }),
  );
});

test("fail-closed: missing sportsbook / eventId / athleteId / market key", () => {
  for (const field of ["sportsbook", "eventId", "athleteId", "propMarketKey"] as const) {
    const p = prop({ [field]: null });
    const check = checkPropProviderProvenance(p);
    assert.equal(check.ok, false, field);
    assert.ok(check.missing.includes(field), field);
  }
});

test("fail-closed: missing or zero odds — never invent Under from Over", () => {
  assert.equal(hasCompletePropProviderProvenance(prop({ odds: 0 })), false);
  assert.equal(hasCompletePropProviderProvenance(prop({ odds: undefined as never })), false);
  // Opposite-side Over quote must not satisfy an Under pick with null odds.
  const underMissing = prop({ odds: undefined as never, sportsbook: null });
  assert.equal(hasCompletePropProviderProvenance(underMissing), false);
  assert.ok(checkPropProviderProvenance(underMissing).missing.includes("odds"));
});

test("enforce strips incomplete props and keeps game lines + evidenced props", () => {
  const gl: ParsedPick = {
    game: "Tampa Bay Buccaneers @ Dallas Cowboys",
    market: "Spread",
    pick: "Cowboys +3.5",
    odds: -110,
    isProp: false,
  };
  const good = prop();
  const bad = prop({
    pick: "Jalon Daniels Under 1.5 Pass TDs",
    player: "Jalon Daniels",
    athleteId: "4596472",
    propMarketKey: "player_pass_tds",
    propLine: 1.5,
    odds: undefined as never,
    sportsbook: null,
  });
  const { picks, stripped } = enforceSeatedPropProviderProvenance([gl, good, bad]);
  assert.equal(picks.length, 2);
  assert.equal(picks[0], gl);
  assert.equal(picks[1], good);
  assert.equal(stripped.length, 1);
  assert.equal(stripped[0]!.pick, bad.pick);
  assert.ok(stripped[0]!.missing.includes("odds"));
  assert.ok(stripped[0]!.missing.includes("sportsbook"));
});

test("UNVERIFIED historical Unders are excluded from release evidence list", () => {
  assert.equal(UNVERIFIED_RELEASE_EVIDENCE_PROPS.length, 2);
  for (const row of UNVERIFIED_RELEASE_EVIDENCE_PROPS) {
    assert.equal(row.status, "UNVERIFIED");
    assert.equal(row.propSide, "Under");
    assert.ok(row.reason.includes("Not used as release evidence"));
  }
});
