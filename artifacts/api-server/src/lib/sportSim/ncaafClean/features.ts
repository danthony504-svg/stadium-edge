/**
 * Pregame feature assembly — venue recovery, rest, injury availability.
 * Never consumes closing odds.
 */

import { identitiesFromFixtureRow } from "./identity.ts";
import type { SubdivisionFixture } from "../ncaafSubdivision.ts";
import {
  venueInfoFromSidecarRow,
  venueSidecarIndex,
  type VenueSidecarRow,
} from "./venueSidecar.ts";
import type {
  AvailabilityInput,
  CleanFixtureGameRow,
  CleanGamePregame,
  CleanGameResult,
  MissingInput,
  RestInfo,
  VenueInfo,
} from "./types.ts";

/**
 * Attempt venue recovery from optional fixture fields / sidecar-applied fields.
 * Unresolved → kind stays `unknown` (never rewritten to neutral).
 *
 * Rules (frozen):
 * - Neutral ONLY when neutralSite === true (explicit).
 * - Home ONLY when neutralSite === false (explicit).
 * - Do not infer neutral from missing fields, bowl flags alone, or team order.
 */
export function recoverVenue(row: CleanFixtureGameRow): VenueInfo {
  const explicit = String(row.venueKind ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "home" || explicit === "neutral" || explicit === "unknown") {
    if (explicit === "neutral") {
      return {
        kind: "neutral",
        neutralReason: "unspecified",
        venueId: row.venueId ?? null,
        source: "explicit_field",
      };
    }
    return {
      kind: explicit as "home" | "unknown",
      venueId: row.venueId ?? null,
      source: "explicit_field",
    };
  }

  if (row.neutralSite === true || row.isNeutral === true) {
    return {
      kind: "neutral",
      neutralReason: "neutral_site",
      venueId: row.venueId ?? null,
      source: "recovered",
    };
  }
  if (row.neutralSite === false || row.isNeutral === false) {
    return {
      kind: "home",
      venueId: row.venueId ?? null,
      source: "recovered",
    };
  }

  // No usable signal — stay explicitly unknown (not silent home, not silent neutral).
  return {
    kind: "unknown",
    venueId: row.venueId ?? null,
    source: "unresolved",
  };
}

/** Days between prior kickoff and this kickoff; null if prior unknown. */
export function daysBetweenKickoffs(
  priorKickoffIso: string | null | undefined,
  kickoffIso: string,
): number | null {
  if (!priorKickoffIso) return null;
  const a = Date.parse(priorKickoffIso);
  const b = Date.parse(kickoffIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / (1000 * 60 * 60 * 24);
}

export function buildRestInfo(opts: {
  kickoffIso: string;
  homePriorKickoffIso?: string | null;
  awayPriorKickoffIso?: string | null;
}): RestInfo {
  return {
    homeDaysRest: daysBetweenKickoffs(
      opts.homePriorKickoffIso,
      opts.kickoffIso,
    ),
    awayDaysRest: daysBetweenKickoffs(
      opts.awayPriorKickoffIso,
      opts.kickoffIso,
    ),
  };
}

/**
 * Injury/availability: only accept captureTimestamp < kickoff.
 * Missing / late / null → injury_unavailable (no invented adjustment).
 */
export function availabilityStatus(opts: {
  kickoffIso: string;
  availability?: AvailabilityInput | null;
}): {
  usable: boolean;
  missing: MissingInput[];
} {
  const missing: MissingInput[] = [];
  const av = opts.availability;
  if (!av) {
    missing.push("injury_unavailable");
    missing.push("qb_availability_unavailable");
    return { usable: false, missing };
  }
  const cap = Date.parse(av.captureTimestamp);
  const kick = Date.parse(opts.kickoffIso);
  if (!Number.isFinite(cap) || !Number.isFinite(kick) || !(cap < kick)) {
    missing.push("injury_unavailable");
    missing.push("qb_availability_unavailable");
    return { usable: false, missing };
  }
  // Usable snapshot present — still may mark QB unknown without inventing outs.
  if (
    av.home.qbStatus === "unknown" &&
    av.away.qbStatus === "unknown"
  ) {
    missing.push("qb_availability_unavailable");
  }
  return { usable: true, missing };
}

export function resultFromFixtureRow(
  row: CleanFixtureGameRow,
): CleanGameResult | null {
  const hs = row.homeFg;
  const as = row.awayFg;
  if (hs == null || as == null) {
    return {
      eventId: row.eventId,
      homeScore: NaN,
      awayScore: NaN,
      decided: false,
      tied: false,
    };
  }
  if (!Number.isFinite(hs) || !Number.isFinite(as)) {
    return {
      eventId: row.eventId,
      homeScore: Number(hs),
      awayScore: Number(as),
      decided: false,
      tied: false,
    };
  }
  const tied = hs === as;
  return {
    eventId: row.eventId,
    homeScore: hs,
    awayScore: as,
    decided: true,
    tied,
  };
}

export function buildPregameFromFixtureRow(
  row: CleanFixtureGameRow,
  opts?: {
    fixture?: SubdivisionFixture;
    homePriorKickoffIso?: string | null;
    awayPriorKickoffIso?: string | null;
    /** Prefer sidecar row when present (joined by eventId+season). */
    venueSidecarRow?: VenueSidecarRow | null;
    /** If true, look up default TUNING venue sidecar by eventId+season. */
    useVenueSidecar?: boolean;
  },
): CleanGamePregame {
  const ids = identitiesFromFixtureRow(row, opts?.fixture);
  let venue: VenueInfo;
  if (opts?.venueSidecarRow) {
    venue = venueInfoFromSidecarRow(opts.venueSidecarRow);
  } else if (opts?.useVenueSidecar) {
    const hit = venueSidecarIndex().get(`${row.eventId}:${row.season}`);
    venue = venueInfoFromSidecarRow(hit);
  } else {
    venue = recoverVenue(row);
  }
  return {
    eventId: row.eventId,
    season: row.season,
    week: row.week ?? null,
    kickoffIso: row.kickoffIso,
    home: ids.home,
    away: ids.away,
    venue,
    rest: buildRestInfo({
      kickoffIso: row.kickoffIso,
      homePriorKickoffIso: opts?.homePriorKickoffIso,
      awayPriorKickoffIso: opts?.awayPriorKickoffIso,
    }),
    matchupScope: ids.matchupScope,
  };
}
