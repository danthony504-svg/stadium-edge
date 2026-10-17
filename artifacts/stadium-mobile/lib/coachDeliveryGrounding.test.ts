/**
 * Incident-derived fixtures for the delivery grounding gate.
 * Original greenfield asks/candidates were unavailable — synthetic tickets only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  applyDeliveryGroundingGate,
  filterPicksForPlayerGameGrounding,
} from "./coachDeliveryGrounding.ts";

function prop(
  overrides: Partial<ParsedPick> & Pick<ParsedPick, "game" | "teamAbbr" | "player">,
): ParsedPick {
  return {
    market: "Hits",
    pick: "Over 0.5",
    odds: -110,
    isProp: true,
    propMarketKey: "batter_hits",
    sport: "mlb",
    ...overrides,
  };
}

test("incident-derived: proven mismatch removed; unknown identity kept", () => {
  const picks = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "Junior Caminero",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "",
      player: "Unknown Player",
    }),
  ];
  const kept = filterPicksForPlayerGameGrounding(picks);
  assert.equal(kept.length, 2);
  assert.equal(kept[0]!.player, "Junior Caminero");
  assert.equal(kept[1]!.player, "Unknown Player");
});

test("incident-derived: replace only with grounded qualified candidates; honest shortfall", () => {
  const picks = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "Junior Caminero",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
    }),
  ];
  const qualified = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "CLE",
      player: "Jose Ramirez",
      market: "Hits",
      pick: "Over 1.5",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "BOS",
      player: "Rafael Devers",
      market: "Hits",
      pick: "Over 0.5",
    }),
  ];
  const result = applyDeliveryGroundingGate({
    picks,
    qualifiedCandidates: qualified,
    target: 3,
  });
  assert.equal(result.removedCount, 1);
  assert.equal(result.replacedCount, 1);
  assert.equal(result.picks.length, 2);
  assert.equal(result.shortfall, 1);
  assert.ok(result.picks.every((p) => p.teamAbbr !== "NYY"));
  assert.ok(result.picks.some((p) => p.player === "Jose Ramirez"));
  assert.ok(!result.picks.some((p) => p.player === "Rafael Devers"));
  assert.equal(result.affectedGame, "Rays @ Guardians");
});

test("buildParlay wires delivery grounding after final belts", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(process.cwd(), "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /applyDeliveryGroundingGate/);
  assert.match(src, /Delivery grounding/);
});
