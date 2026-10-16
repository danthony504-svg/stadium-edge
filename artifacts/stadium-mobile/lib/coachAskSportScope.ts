/**
 * Hard sport-scope locks + college clarification for Coach N-leg builds.
 *
 * Bare "college" historically mapped silently to NCAAF. When the token is
 * ambiguous (football vs basketball), surface a clarification note rather than
 * silently selecting the wrong sport — while still defaulting the board to
 * college football so existing CFB team-market asks keep working.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  focalSportsFromText,
  isSoftSportPreferenceAsk,
  softSportPreferenceExpandsBoard,
} from "./chatContextPriority.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

/** Normalize aliases so CFB / feed keys compare equal to board ids. */
export function canonicalizeCoachAskSport(sport: string | null | undefined): string {
  const s = String(sport ?? "")
    .toLowerCase()
    .trim();
  if (!s) return "";
  if (s === "cfb" || s.includes("americanfootball_ncaaf") || s === "college-football") {
    return "ncaaf";
  }
  if (s === "cbb" || s.includes("basketball_ncaab") || s === "college-basketball") {
    return "ncaab";
  }
  return s;
}

/** Bare "college"/"collage" without football|basketball|NCAAF|CFB|NCAAB|CBB. */
export function isBareCollegeTokenAsk(text: string | null | undefined): boolean {
  const t = String(text || "");
  if (!/\b(college|collage)\b/i.test(t)) return false;
  if (/\b(college|collage)\s+(football|basketball)\b/i.test(t)) return false;
  if (/\bncaaf\b|\bcfb\b|\bncaab\b|\bcbb\b/i.test(t)) return false;
  return true;
}

/**
 * College sport is ambiguous — bare college/collage, or bare NCAA without a
 * football/basketball qualifier. Never invent a pro board for these asks.
 */
export function isAmbiguousCollegeSportAsk(text: string | null | undefined): boolean {
  const t = String(text || "");
  if (isBareCollegeTokenAsk(t)) return true;
  if (
    /\bncaa\b/i.test(t) &&
    !/\bncaaf\b|\bncaab\b|\bcfb\b|\bcbb\b/i.test(t) &&
    !/\b(college|collage)\s+(football|basketball)\b/i.test(t) &&
    !/\bfootball\b|\bbasketball\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Exclusive sports for a hard-named ask (`null` = generic / soft-expand — mix OK).
 * Soft prefs ("mostly baseball") return null so football can still mix.
 */
export function hardLockedSportsFromAsk(
  text: string | null | undefined,
): string[] | null {
  const focal = focalSportsFromText(text);
  if (focal.size === 0) return null;
  if (isSoftSportPreferenceAsk(text) && softSportPreferenceExpandsBoard(focal)) {
    return null;
  }
  return [...focal].map(canonicalizeCoachAskSport).filter(Boolean);
}

/** Cross-sport inject/floor is only for generic / soft-pref boards. */
export function allowsCrossSportMix(text: string | null | undefined): boolean {
  return hardLockedSportsFromAsk(text) == null;
}

export function pickMatchesAskSports(
  pick: { sport?: string | null },
  allowed: readonly string[] | null | undefined,
): boolean {
  if (!allowed?.length) return true;
  const allow = new Set(allowed.map(canonicalizeCoachAskSport));
  const s = canonicalizeCoachAskSport(pick.sport);
  // Fail closed on untagged legs when the ask hard-locked a sport.
  if (!s) return false;
  return allow.has(s);
}

export function filterPicksForAskSports<T extends { sport?: string | null }>(
  picks: readonly T[],
  allowed: readonly string[] | null | undefined,
): T[] {
  if (!allowed?.length) return picks.slice() as T[];
  return picks.filter((p) => pickMatchesAskSports(p, allowed));
}

export function filterScoredLegsForAskSports(
  scored: readonly BoardScoredLeg[],
  allowed: readonly string[] | null | undefined,
): BoardScoredLeg[] {
  if (!allowed?.length) return scored.slice();
  return scored.filter((leg) => pickMatchesAskSports(leg.pick, allowed));
}

/**
 * Clarification copy — never claim pro sports when college is ambiguous.
 * Bare "college" defaults to NCAAF team markets but tells the user how to ask
 * for CBB instead of silently selecting basketball.
 */
export function bareCollegeClarificationNote(
  text: string | null | undefined,
): string | null {
  if (!isAmbiguousCollegeSportAsk(text)) return null;
  const t = String(text || "");
  if (/\bncaa\b/i.test(t) && !isBareCollegeTokenAsk(t)) {
    return "You said NCAA — did you mean college football (NCAAF) or college basketball (NCAAB)? Reply with the sport so I keep the board college-only.";
  }
  return (
    'You said college — treating this as college football (NCAAF) team markets ' +
    '(spreads / moneylines / totals), not college basketball. Say "college basketball" ' +
    "if you meant CBB. College player props are not on this bare ask. " +
    "I will not mix in NFL, MLB, or other pro leagues."
  );
}

/** Honest under-count when a hard sport lock cannot fill N. */
export function sportScopeShortfallNote(
  text: string | null | undefined,
  target: number,
  delivered: number,
  locked: readonly string[] | null | undefined,
): string | null {
  if (!locked?.length) return null;
  if (delivered >= target) return null;
  const label = locked.map((s) => s.toUpperCase()).join("/");
  if (delivered <= 0) {
    return `No qualifying ${label} picks were available for this ${target}-leg ask — I won't fill with other sports.`;
  }
  return `Only ${delivered} of ${target} qualifying ${label} picks were available — shortfall, not filled with other sports.`;
}

/** Sports present on a ticket (canonical ids). */
export function sportsOnPicks(picks: readonly ParsedPick[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const s = canonicalizeCoachAskSport(p.sport);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
