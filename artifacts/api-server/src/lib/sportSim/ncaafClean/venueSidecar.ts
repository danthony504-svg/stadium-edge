/**
 * Load venue sidecar joined by eventId + season.
 * Original game fixtures stay untouched.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VenueInfo, VenueKind } from "./types.ts";

export type VenueSidecarRow = {
  eventId: string;
  season: number;
  kind: VenueKind;
  neutralSite: boolean | null;
  venueId: string | null;
  venueName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  indoor?: boolean | null;
  international?: boolean;
  conferenceCompetition?: boolean | null;
  reason?: string;
  source?: string | null;
  provenance?: string;
};

export type VenueSidecarDoc = {
  generatedAt: string;
  source: string;
  joinKeys: string[];
  rules: Record<string, string>;
  counts: Record<string, number>;
  games: VenueSidecarRow[];
};

let cached: VenueSidecarDoc | null = null;
let cachedPath: string | null = null;

function defaultSidecarPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // ncaafClean → sportSim → lib → src → api-server/test/fixtures
  return join(
    here,
    "../../../../test/fixtures/ncaaf-tuning-2025-w1-7-games.venue-tags.json",
  );
}

export function loadVenueSidecar(path = defaultSidecarPath()): VenueSidecarDoc {
  if (cached && cachedPath === path) return cached;
  const raw = JSON.parse(readFileSync(path, "utf8")) as VenueSidecarDoc;
  cached = raw;
  cachedPath = path;
  return raw;
}

export function resetVenueSidecarCache(): void {
  cached = null;
  cachedPath = null;
}

export function venueSidecarIndex(
  doc?: VenueSidecarDoc,
): Map<string, VenueSidecarRow> {
  const d = doc ?? loadVenueSidecar();
  const m = new Map<string, VenueSidecarRow>();
  for (const g of d.games) {
    m.set(`${g.eventId}:${g.season}`, g);
  }
  return m;
}

/**
 * Map sidecar row → VenueInfo.
 * Only explicit ESPN neutralSite true/false become neutral/home.
 */
export function venueInfoFromSidecarRow(
  row: VenueSidecarRow | undefined,
): VenueInfo {
  if (!row || row.kind === "unknown") {
    return {
      kind: "unknown",
      venueId: row?.venueId ?? null,
      source: "unresolved",
    };
  }
  if (row.kind === "neutral" && row.neutralSite === true) {
    return {
      kind: "neutral",
      neutralReason: row.international
        ? "neutral_site"
        : row.conferenceCompetition
          ? "conference_championship"
          : "neutral_site",
      venueId: row.venueId,
      source: "recovered",
    };
  }
  if (row.kind === "home" && row.neutralSite === false) {
    return {
      kind: "home",
      venueId: row.venueId,
      source: "recovered",
    };
  }
  // Non-explicit — refuse to guess
  return {
    kind: "unknown",
    venueId: row.venueId ?? null,
    source: "unresolved",
  };
}
