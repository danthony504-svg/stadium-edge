/**
 * Pure helpers for Coach board-scan prop delivery.
 * Kept free of api.ts so node:test can cover the 7-leg → 3 F5 latch without
 * loading the full scanner module graph.
 */

import {
  type CoachScanFailureReason,
  type CoachScanFailureDiagnostics,
} from "./coachScanFailureReason.ts";
import { sanitizeCoachUserNote } from "./sanitizeCoachUserNote.ts";
import { COACH_PRIORITY_SPORTS } from "./coachPrioritySports.ts";
import { isPeriodMainMarket } from "./altLinePool.ts";
import { parseMarketPeriod } from "./simMarketSupport.ts";
import { maxLegsPerGame, maxPropsPerGame, wouldExceedMaxLegsPerGame, wouldExceedMaxPropsPerGame, wouldRepeatPlayerProp } from "./parlayCorrelationScore.ts";

/** ~50% of an N-leg ticket is reserved for player props (matches preview staging). */
export function boardScanPropSlotCount(
  targetLegs: number,
  propFraction = 0.5,
): number {
  if (targetLegs < 3) return 0;
  return Math.max(1, Math.round(targetLegs * propFraction));
}

/** True when staged picks are mostly NFL/NCAAF — use a lower prop-seat floor. */
export function isFootballHeavyPickList(
  picks: { sport?: string | null }[],
): boolean {
  let football = 0;
  let total = 0;
  for (const p of picks) {
    const s = String(p.sport ?? "").toLowerCase();
    if (!s) continue;
    total += 1;
    if (s === "nfl" || s === "ncaaf") football += 1;
  }
  return total > 0 && football / total >= 0.6;
}

/**
 * True when the ask is college-football-only (no NFL / other leagues).
 * Phone: college books mostly post team markets, not player yards/TD boards.
 */
export function askIsCollegeFootballOnly(text?: string | null): boolean {
  const t = String(text ?? "").toLowerCase();
  if (!t) return false;
  const hasCollege =
    /\bncaaf\b/.test(t) ||
    /\bcfb\b/.test(t) ||
    /\bcollege\s+football\b/.test(t) ||
    /\bcollage\s+football\b/.test(t) ||
    (/\b(?:college|collage)\b/.test(t) &&
      !/\b(?:college|collage)\s+basketball\b/.test(t) &&
      !/\bncaab\b|\bcbb\b/.test(t));
  if (!hasCollege) return false;
  if (/\bnfl\b/.test(t)) return false;
  if (/\b(nba|mlb|nhl|wnba|ncaab|soccer|futbol|ufc|tennis)\b/.test(t)) {
    return false;
  }
  // Bare "football" alone fans NFL+NCAAF — not college-only.
  if (
    /\bfootball\b/.test(t) &&
    !/\bcollege\s+football\b|\bcollage\s+football\b|\bncaaf\b|\bcfb\b/.test(t)
  ) {
    return false;
  }
  return true;
}

/**
 * College books post FG spreads + Q2 / 1H + team totals as the team-prop surface.
 * Allow those same-team period stacks under the raised per-game cap so a
 * "7 leg college" ask can fill toward N from qualified team markets — unlike
 * NHL "team props", which still collapses FG+Q2 to one side per team.
 * Applies on college mix tickets (yards + periods), not only game-lines-only.
 */
export function askAllowsCollegeTeamMarketStacks(text?: string | null): boolean {
  return askIsCollegeFootballOnly(text);
}

/**
 * True when the user explicitly asked for CFB player props / skill markets.
 * Bare "8 leg college" / "8 leg Collage" stays on team spreads / totals /
 * period lines — college books rarely post player yards boards.
 */
export function askAllowsNcaafPlayerProps(text?: string | null): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/\b(\d{1,3})\s*[-\s]?\s*lags?\b/g, "$1 leg");
  if (!t) return false;
  if (/\bno\s+player\s+props?\b/.test(t)) return false;
  if (/\bwithout\s+player\s+props?\b/.test(t)) return false;
  if (/\bno\s+props?\b/.test(t)) return false;
  if (/\bteam\s+props?\b/.test(t) && !/\bplayer\s+props?\b/.test(t)) return false;
  if (/\bgame\s*lines?\s+only\b/.test(t)) return false;
  if (/\bsides?\s+only\b/.test(t)) return false;
  if (/\bplayer\s+props?\b/.test(t)) return true;
  if (/\bwith\s+(?:player\s+)?props?\b/.test(t)) return true;
  if (/\b(?:player\s+)?props?\s+only\b/.test(t)) return true;
  if (/\bonly\s+(?:player\s+)?props?\b/.test(t)) return true;
  if (/\b(?:passing|rushing|receiving)\s+yards?\b/.test(t)) return true;
  if (/\b(?:pass|rush|rec)\s+yds?\b/.test(t)) return true;
  if (/\banytime\s+(?:td|touchdown)\b/.test(t)) return true;
  if (/\b(?:first|1st)\s+(?:td|touchdown)\b/.test(t)) return true;
  if (/\btouchdowns?\b/.test(t)) return true;
  if (/\breceptions?\b/.test(t)) return true;
  if (/\bsacks?\b/.test(t)) return true;
  // "N leg … props" (not "team props") — honor explicit props asks on CFB.
  if (
    /\b\d{1,3}\s*[-\s]?\s*legs?\b[\s\w]{0,40}\bprops?\b/.test(t) &&
    !/\bteam\s+props?\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Drop NCAAF player-prop rows when the ask prefers college team markets. */
export function filterNcaafPlayerPropsUnlessAsked<
  T extends { sport?: string | null; isProp?: boolean },
>(rows: T[], askText?: string | null): T[] {
  if (askAllowsNcaafPlayerProps(askText)) return rows;
  return rows.filter((row) => {
    const sport = String(row.sport ?? "").toLowerCase();
    if (sport !== "ncaaf" && sport !== "cfb") return true;
    // Prop-pool entries are always player props; staged picks use isProp.
    if (row.isProp === false) return true;
    if (row.isProp === true) return false;
    // Untagged pool rows (PropPoolEntry) for NCAAF are player props.
    return false;
  });
}

/**
 * Bare "10 leg nfl" / "football" asks expect a skill-prop mix.
 * Bare NCAAF / college football stays on team markets (spreads / totals /
 * period lines) unless the user named player props / yards / TDs.
 * Not props-only (spreads can remain) and not "with no player props".
 */
export function askRequiresFootballPropMix(text?: string | null): boolean {
  const t = String(text ?? "").toLowerCase();
  if (!t) return false;
  if (/\bno\s+player\s+props?\b/.test(t)) return false;
  if (/\bwithout\s+player\s+props?\b/.test(t)) return false;
  if (/\bno\s+props?\b/.test(t)) return false;
  if (/\bgame\s*lines?\s+only\b/.test(t)) return false;
  if (/\bsides?\s+only\b/.test(t)) return false;
  // Explicit team-props asks stay on team markets only (no yards mix).
  if (/\bteam\s+props?\b/.test(t) && !/\bplayer\s+props?\b/.test(t)) return false;
  // College-only without explicit player-prop ask → team markets, not prop mix.
  if (askIsCollegeFootballOnly(t) && !askAllowsNcaafPlayerProps(t)) return false;
  return (
    /\bnfl\b/.test(t) ||
    // Explicit CFB player-prop asks still use the football mix / props path.
    (askIsCollegeFootballOnly(t) && askAllowsNcaafPlayerProps(t)) ||
    (/\bfootball\b/.test(t) &&
      !/\bsoccer|nba|mlb|nhl|wnba|ncaab\b/.test(t) &&
      // "college football" is handled above — don't treat it as NFL mix.
      !/\bcollege\s+football\b|\bcollage\s+football\b|\bncaaf\b|\bcfb\b/.test(t))
  );
}

/** Game-line capacity while reserved prop seats stay open. */
export function boardScanNonPropPreviewCap(
  targetLegs: number,
  propFraction = 0.5,
): number {
  return Math.max(0, targetLegs - boardScanPropSlotCount(targetLegs, propFraction));
}

/**
 * Hold reserved prop seats open so game lines cannot paint the full ticket.
 *
 * Preview + football mix: seats stay conceptually reserved via
 * `awaitingPropSlots` / `finalizeFootballPropMixPicks`. Non-football never
 * truncates the pick array for empty prop seats — that published exactly
 * `boardScanNonPropPreviewCap(N)` legs on budget timeout (5→2 / 6→3) and
 * blamed the quality bar.
 */
export function shouldReservePropSeats(opts: {
  preview?: boolean;
  propsOnly?: boolean;
  gameLinesOnly?: boolean;
  targetLegs: number;
  propCount: number;
  propPhaseIncomplete?: boolean;
  /** Football ask — never pad prop seats with game lines on the final ticket. */
  requirePropMix?: boolean;
}): boolean {
  if (opts.propsOnly || opts.gameLinesOnly || opts.targetLegs < 3) return false;
  const propSlots = boardScanPropSlotCount(
    opts.targetLegs,
    opts.requirePropMix ? 0.4 : 0.5,
  );
  if (propSlots <= 0 || opts.propCount >= propSlots) return false;
  // Preview awaiting latch (cards stay hidden) — does NOT truncate picks.
  if (opts.preview) return true;
  // Football mix: keep seats open through finalizeFootballPropMixPicks.
  if (opts.requirePropMix) return true;
  // Non-football final: never hold empty prop seats in the pick array.
  return false;
}

/**
 * Trim game lines to the non-prop seat budget so reserved prop slots stay open.
 * Does not invent props — short tickets are honest when props have not cleared.
 */
export function applyReservedPropSeatCap<T extends { isProp?: boolean }>(
  picks: T[],
  targetLegs: number,
  propFraction = 0.5,
): T[] {
  if (targetLegs < 3) return picks.slice(0, Math.max(0, targetLegs));
  const propSlots = boardScanPropSlotCount(targetLegs, propFraction);
  if (propSlots <= 0) return picks.slice(0, targetLegs);
  const props = picks.filter((p) => !!p.isProp);
  const nonProps = picks.filter((p) => !p.isProp);
  const nonPropCap = Math.max(0, targetLegs - propSlots);
  return [...props, ...nonProps.slice(0, nonPropCap)].slice(0, targetLegs);
}

/**
 * Rebuild contract for football mix asks ("10 leg nfl"):
 * - Preview / props still scoring: keep GL under the non-prop seat cap.
 * - Final with player props: keep props + GL under the reserved mix seats.
 * - Final after props exhausted with 0 props: deliver cleared GLs (honest
 *   shortfall). Never wipe into SCORED_BUT_NOT_STAGED empty.
 * - Never fill all N seats with spreads while props are still incomplete.
 */
export function finalizeFootballPropMixPicks<T extends { isProp?: boolean }>(
  picks: T[],
  targetLegs: number,
  opts?: { preview?: boolean; propPhaseIncomplete?: boolean },
): T[] {
  if (targetLegs < 3) return picks.slice(0, Math.max(0, targetLegs));
  const propFraction = 0.4;
  if (opts?.preview || opts?.propPhaseIncomplete) {
    return applyReservedPropSeatCap(picks, targetLegs, propFraction);
  }
  const props = picks.filter((p) => !!p.isProp);
  if (props.length === 0) {
    // Props finished with nothing cleared — ship the game lines that did.
    return picks.slice(0, targetLegs);
  }
  return applyReservedPropSeatCap(picks, targetLegs, propFraction);
}

/**
 * Non-football mix (MLB / NBA / NHL / soccer / UFC, …):
 *
 * Never truncate qualified legs for empty prop seats. Mid-scan UI gating uses
 * `awaitingPropSlots` (preview + 0 props) so cards stay hidden until terminal;
 * destroying GLs in the pick array left the hang-guard / budget-timeout path
 * publishing exactly `boardScanNonPropPreviewCap(N)` legs (phone: 5→2, 6→3)
 * and blaming the quality bar.
 *
 * Football mix keeps `finalizeFootballPropMixPicks` (hold seats while incomplete).
 */
export function finalizeGeneralPropMixPicks<T extends { isProp?: boolean }>(
  picks: T[],
  targetLegs: number,
  _opts?: { preview?: boolean; propFraction?: number },
): T[] {
  if (targetLegs < 3) return picks.slice(0, Math.max(0, targetLegs));
  return picks.slice(0, targetLegs);
}

/**
 * Preview-only gate (legacy name). Prefer shouldReservePropSeats for new call sites.
 * Kept so existing tests / callers keep working — finals no longer wipe to empty.
 */
export function shouldKeepAwaitingPropSlots(opts: {
  preview?: boolean;
  propsOnly?: boolean;
  targetLegs: number;
  propCount: number;
  propPhaseIncomplete?: boolean;
  requirePropMix?: boolean;
  gameLinesOnly?: boolean;
}): boolean {
  // Awaiting UI latch stays preview-only (never wipe finals to 0 legs).
  if (!opts.preview) return false;
  return shouldReservePropSeats(opts) && opts.propCount === 0;
}

function countPropLikePicks(picks: { isProp?: boolean; market?: string }[]): number {
  // Alt Spreads are NOT player props — counting /alt/i faked "props done" and
  // skipped the grace window meant to finish real prop scoring.
  return picks.filter((p) => !!p.isProp).length;
}

/**
 * Final ticket picks after a board scan. Never wipe cleared legs when props are
 * incomplete — that was the post-#469 instant 0-of-7 failure (phone screenshot).
 *
 * Old buggy formula (must stay dead):
 *   propPoolSize > 0 && propLike === 0 && awaitingPropSlots → []
 */
export function selectFinalCoachParlayPicks<T extends { isProp?: boolean; market?: string }>(
  rawPicks: T[],
): T[] {
  return rawPicks;
}

function propFillFingerprint(pick: {
  game?: string | null;
  player?: string | null;
  market?: string | null;
  pick?: string | null;
  side?: string | null;
}): string {
  return [
    String(pick.game ?? ""),
    String(pick.player ?? ""),
    String(pick.market ?? ""),
    String(pick.pick ?? ""),
    String(pick.side ?? ""),
  ]
    .join("|")
    .toLowerCase();
}

function propFillComposite(pick: {
  finalAiScore?: { composite?: number } | null;
  scores?: { composite?: number } | null;
}): number {
  return pick.finalAiScore?.composite ?? pick.scores?.composite ?? 0;
}

function normalizePropMarket(market: string | null | undefined): string {
  return String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
}

export type SkillPropFamily =
  | "sack"
  | "rush"
  | "pass"
  | "rec"
  | "td"
  | "hr"
  | "hits"
  | "rbi"
  | "runs"
  | "strikeouts"
  | "outs"
  | "points"
  | "rebounds"
  | "assists"
  | "threes"
  | "pra"
  | "double_double"
  | "goals"
  | "sog"
  | "shots"
  | null;

/**
 * Prefer classic skill props across sports when filling reserved slots.
 * Football: TD + pass/rec/rush yards (incl alt milestones) outrank sacks / misc.
 * MLB: HR / hits / K; NBA/NCAAB: points / reb / ast; NHL/soccer: goals / sog.
 */
export function skillPropRank(market: string | null | undefined): number {
  const m = normalizePropMarket(market);
  if (!m) return 0;

  // —— Football (NFL / NCAAF) ——
  if (/\btd\b|touchdown|\btds\b/.test(m)) return 6;
  if (/\bpass\b/.test(m) && /yd|yard/.test(m) && !/completion|attempt|int/.test(m)) return 5;
  if (/\breception|\breceiving|\brec\b/.test(m) && /yd|yard/.test(m)) return 5;
  if (/\brush\b|\brushing\b/.test(m) && /yd|yard/.test(m)) return 5;
  if (/\bsack/.test(m)) return 3;
  if (/\brush\b|\bpass\b|\breception|\breceiv/.test(m)) return 2;
  if (/\bfield\s*goals?\b|\bfgs?\b/.test(m)) return 2;
  // D/ST (tackles / kicking / defensive INTs) — below skill yards & sacks so they
  // only fill after classic props; must precede basketball "assists" match.
  if (
    /\btackles?\b/.test(m) ||
    /kicking\s*points/.test(m) ||
    /defensive\s*interceptions?/.test(m)
  ) {
    return 1;
  }

  // —— MLB ——
  if (/home\s*runs?|homer|\bhr\b/.test(m)) return 6;
  if (/hits\s*runs\s*rbis?|batter\s*hits\s*runs/.test(m)) return 5;
  if (/batter\s*hits|\bhitter\s*hits|\bhits\b/.test(m) && /batter|hitter/.test(m)) return 5;
  if (/\brbis?\b/.test(m)) return 5;
  if (/batter\s*runs|\brun\s*scored/.test(m)) return 5;
  if (/strikeouts?|\bpitcher\s*k\b/.test(m)) return 5;
  if (/pitcher\s*outs|\bouts\b/.test(m) && /pitcher/.test(m)) return 3;

  // —— Basketball (NBA / NCAAB / WNBA) ——
  if (/points\s*rebounds\s*assists|\bpra\b/.test(m)) return 5;
  if (/double\s*double/.test(m)) return 4;
  if (/\bthrees?\b|3\s*pt|three\s*point/.test(m)) return 5;
  if (/rebounds?/.test(m)) return 5;
  if (/assists?/.test(m)) return 5;
  if (/player\s*points|\bpoints\b/.test(m) && !/rebounds|assists|goal/.test(m)) return 6;

  // —— NHL ——
  if (/player\s*goals|\bgoals?\b/.test(m) && !/field|scorer|shot/.test(m)) return 6;
  if (/shots\s*on\s*goal/.test(m)) return 4;
  if (/player\s*points/.test(m)) return 5;

  // —— Soccer ——
  if (/goal\s*scorer|anytime\s*goal|first\s*goal/.test(m)) return 6;
  if (/shots\s*on\s*target/.test(m)) return 4;
  if (/\bshots\b/.test(m) && !/goal/.test(m)) return 3;

  return 0;
}

/** Bucket skill markets so reserved slots diversify across families (not 4× one type). */
export function skillPropFamily(market: string | null | undefined): SkillPropFamily {
  const m = normalizePropMarket(market);
  if (!m) return null;

  // Football — TD before rush/pass/rec so player_rush_tds is "td", not "rush".
  if (/\btd\b|touchdown|\btds\b/.test(m)) return "td";
  if (/\bsack/.test(m)) return "sack";
  // D/ST before basketball assists (player_tackles_assists contains "assists").
  if (
    /\btackles?\b/.test(m) ||
    /kicking\s*points/.test(m) ||
    /defensive\s*interceptions?/.test(m)
  ) {
    return null;
  }
  if (/\brush\b|\brushing\b/.test(m)) return "rush";
  if (/\bpass\b|\bpassing\b/.test(m) && !/completion/.test(m)) return "pass";
  if (/\breception|\breceiving|\brec\b/.test(m)) return "rec";

  // MLB
  if (/home\s*runs?|homer|\bhr\b/.test(m)) return "hr";
  if (/strikeouts?/.test(m)) return "strikeouts";
  if (/hits\s*runs\s*rbis?/.test(m)) return "hits";
  if (/batter\s*hits|\bhitter\s*hits/.test(m)) return "hits";
  if (/\brbis?\b/.test(m)) return "rbi";
  if (/batter\s*runs/.test(m)) return "runs";
  if (/pitcher\s*outs/.test(m)) return "outs";

  // Basketball
  if (/points\s*rebounds\s*assists|\bpra\b/.test(m)) return "pra";
  if (/double\s*double/.test(m)) return "double_double";
  if (/\bthrees?\b|3\s*pt|three\s*point/.test(m)) return "threes";
  if (/rebounds?/.test(m)) return "rebounds";
  if (/assists?/.test(m)) return "assists";
  if (/player\s*points|\bpoints\b/.test(m) && !/goal|scorer/.test(m)) return "points";

  // NHL / soccer
  if (/goal\s*scorer|anytime\s*goal|first\s*goal|player\s*goals|\bgoals?\b/.test(m) && !/field/.test(m)) {
    return "goals";
  }
  if (/shots\s*on\s*goal|shots\s*on\s*target/.test(m)) return "sog";
  if (/\bshots\b/.test(m)) return "shots";

  return null;
}

/** Soft prefer classic alt rush milestones (25+ / 50+ / 75+ / 100+). */
export function footballRushMilestoneBonus(pick: {
  market?: string | null;
  propLine?: number | null;
  pick?: string | null;
}): number {
  if (skillPropFamily(pick.market) !== "rush") return 0;
  let line = pick.propLine;
  if (line == null || !Number.isFinite(line)) {
    const m = String(pick.pick ?? "").match(/(\d+(?:\.\d+)?)/);
    line = m ? Number(m[1]) : null;
  }
  if (line == null || !Number.isFinite(line)) return 0;
  const milestones = [24.5, 25, 25.5, 49.5, 50, 50.5, 74.5, 75, 75.5, 99.5, 100, 100.5];
  if (milestones.some((x) => Math.abs((line as number) - x) < 0.01)) return 2;
  if (line >= 20 && line <= 110) return 1;
  return 0;
}

/** Soft prefer classic skill milestones across sports (rush alts, HR 0.5/1.5, etc.). */
export function skillPropMilestoneBonus(pick: {
  market?: string | null;
  propLine?: number | null;
  pick?: string | null;
}): number {
  const rush = footballRushMilestoneBonus(pick);
  if (rush > 0) return rush;
  const fam = skillPropFamily(pick.market);
  let line = pick.propLine;
  if (line == null || !Number.isFinite(line)) {
    const m = String(pick.pick ?? "").match(/(\d+(?:\.\d+)?)/);
    line = m ? Number(m[1]) : null;
  }
  if (line == null || !Number.isFinite(line)) return 0;
  if (fam === "hr" && (Math.abs(line - 0.5) < 0.01 || Math.abs(line - 1.5) < 0.01)) return 2;
  if (fam === "strikeouts") {
    const kMiles = [4.5, 5.5, 6.5, 7.5, 8.5];
    if (kMiles.some((x) => Math.abs((line as number) - x) < 0.01)) return 1;
  }
  if (fam === "points" || fam === "rebounds" || fam === "assists") {
    // Common half-lines stay preferred over odd decimals when ranking ties.
    if (Math.abs(line - Math.floor(line) - 0.5) < 0.01) return 1;
  }
  return 0;
}

/** @deprecated Prefer skillPropRank — kept for existing football-focused tests. */
export function footballSkillPropRank(market: string | null | undefined): number {
  return skillPropRank(market);
}

/** @deprecated Prefer skillPropFamily — kept for existing football-focused tests. */
export function footballSkillPropFamily(
  market: string | null | undefined,
): "sack" | "rush" | "pass" | "rec" | "td" | null {
  const fam = skillPropFamily(market);
  if (fam === "sack" || fam === "rush" || fam === "pass" || fam === "rec" || fam === "td") {
    return fam;
  }
  return null;
}

type PropFillPick = {
  isProp?: boolean;
  market?: string | null;
  game?: string | null;
  player?: string | null;
  pick?: string | null;
  side?: string | null;
  sport?: string | null;
  propLine?: number | null;
  propMarketKey?: string | null;
  finalAiScore?: { composite?: number } | null;
  scores?: { composite?: number } | null;
};

type PropFillLeg<T extends PropFillPick> = {
  pick: T;
  rankScore?: number;
};

/**
 * Enforce ~50% player-prop slots on a staged ticket when qualified props exist.
 * GameLines-first combinators were shipping ML/totals-only tickets even after
 * rush/pass/rec/sack props had cleared scoring — this swaps/backfills props into
 * reserved slots without inventing legs.
 */
export function fillReservedPropSlots<T extends PropFillPick>(
  picks: T[],
  scored: PropFillLeg<T>[],
  target: number,
  legsPerGameCap?: number | null,
): T[] {
  if (target < 3) return picks.slice(0, Math.max(0, target));
  // Football mix tickets intentionally reserve more side seats (~40% props).
  const propSlots = boardScanPropSlotCount(
    target,
    isFootballHeavyPickList(picks) ? 0.4 : 0.5,
  );
  if (propSlots <= 0) return picks.slice(0, target);

  let out = picks.slice(0, target);
  const used = new Set(out.map(propFillFingerprint));
  let propCount = out.filter((p) => !!p.isProp).length;
  if (propCount >= propSlots) return out;

  const familyCounts = new Map<string, number>();
  for (const p of out) {
    const fam = skillPropFamily(p.market);
    if (fam) familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
  }

  const remaining = () =>
    scored.filter((leg) => {
      if (!leg.pick?.isProp) return false;
      return !used.has(propFillFingerprint(leg.pick));
    });

  const pickNext = () => {
    const pool = remaining().sort((a, b) => {
      const aKey = a.pick.propMarketKey || a.pick.market;
      const bKey = b.pick.propMarketKey || b.pick.market;
      const aSkill = skillPropRank(aKey) + skillPropMilestoneBonus(a.pick);
      const bSkill = skillPropRank(bKey) + skillPropMilestoneBonus(b.pick);
      // Skill props first, then diversify families (td/hr/points/…), then rank.
      const aSkillful = aSkill > 0 ? 1 : 0;
      const bSkillful = bSkill > 0 ? 1 : 0;
      if (aSkillful !== bSkillful) return bSkillful - aSkillful;
      const aFam = skillPropFamily(aKey);
      const bFam = skillPropFamily(bKey);
      const aSeen = aFam ? (familyCounts.get(aFam) ?? 0) : 99;
      const bSeen = bFam ? (familyCounts.get(bFam) ?? 0) : 99;
      if (aSeen !== bSeen) return aSeen - bSeen;
      if (aSkill !== bSkill) return bSkill - aSkill;
      const rank = (b.rankScore ?? 0) - (a.rankScore ?? 0);
      if (rank !== 0) return rank;
      return propFillComposite(b.pick) - propFillComposite(a.pick);
    });
    return pool[0] ?? null;
  };

  while (propCount < propSlots) {
    const cand = pickNext();
    if (!cand) break;
    const fp = propFillFingerprint(cand.pick);
    const fam = skillPropFamily(cand.pick.propMarketKey || cand.pick.market);
    const maxPerGame = maxLegsPerGame(target, legsPerGameCap);
    const maxProps = maxPropsPerGame(target);

    if (out.length < target) {
      if (wouldExceedMaxLegsPerGame(cand.pick, out, maxPerGame)) {
        used.add(fp);
        continue;
      }
      if (wouldRepeatPlayerProp(cand.pick, out)) {
        used.add(fp);
        continue;
      }
      if (wouldExceedMaxPropsPerGame(cand.pick, out, maxProps)) {
        used.add(fp);
        continue;
      }
      out = [...out, cand.pick];
    } else {
      let worstIdx = -1;
      let worstScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (p.isProp) continue;
        // Keep the only NFL/NCAAF seat — prop fill was wiping soft football injects.
        const sid = String(p.sport ?? "").toLowerCase();
        if (
          (COACH_PRIORITY_SPORTS as readonly string[]).includes(sid) &&
          out.filter((x) => String(x.sport ?? "").toLowerCase() === sid).length <= 1
        ) {
          continue;
        }
        const score = propFillComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
      }
      if (worstIdx < 0) break;
      const withoutWorst = out.filter((_, i) => i !== worstIdx);
      if (wouldExceedMaxLegsPerGame(cand.pick, withoutWorst, maxPerGame)) {
        used.add(fp);
        continue;
      }
      if (wouldRepeatPlayerProp(cand.pick, withoutWorst)) {
        used.add(fp);
        continue;
      }
      if (wouldExceedMaxPropsPerGame(cand.pick, withoutWorst, maxProps)) {
        used.add(fp);
        continue;
      }
      const next = out.slice();
      next[worstIdx] = cand.pick;
      out = next;
    }
    used.add(fp);
    propCount += 1;
    if (fam) familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
  }

  return out.slice(0, target);
}

/** ~25% of an N-leg college ticket reserved for half / quarter team markets. */
export function boardScanPeriodSlotCount(targetLegs: number): number {
  if (targetLegs < 4) return 0;
  return Math.max(1, Math.round(targetLegs * 0.25));
}

/** ~15% of an N-leg college ticket reserved for posted team total points. */
export function boardScanTeamTotalSlotCount(targetLegs: number): number {
  if (targetLegs < 5) return 0;
  return Math.max(1, Math.round(targetLegs * 0.15));
}

/** True for 1H / Q1–Q4 / period team totals — not full-game FG spreads. */
export function isCollegePeriodMarketPick(pick: {
  market?: string | null;
  isProp?: boolean;
}): boolean {
  if (pick.isProp) return false;
  const m = String(pick.market ?? "");
  if (!m.trim()) return false;
  if (isPeriodMainMarket(m)) return true;
  if (parseMarketPeriod(m) !== "fg") return true;
  return false;
}

/** Posted Team Total / Alt Team Total / period team totals (points only). */
export function isCollegeTeamTotalPick(pick: {
  market?: string | null;
  isProp?: boolean;
}): boolean {
  if (pick.isProp) return false;
  return /team total/i.test(String(pick.market ?? ""));
}

/**
 * College mix: reserve half/quarter seats so FG alt spreads cannot fill every
 * slot before period team markets get a chance. Swaps lowest-ranked FG legs
 * for qualified period leftovers — never invents filler.
 */
export function fillReservedPeriodSlots<T extends PropFillPick>(
  picks: T[],
  scored: PropFillLeg<T>[],
  target: number,
  legsPerGameCap?: number | null,
): T[] {
  if (target < 4) return picks.slice(0, Math.max(0, target));
  const periodSlots = boardScanPeriodSlotCount(target);
  if (periodSlots <= 0) return picks.slice(0, target);

  let out = picks.slice(0, target);
  const used = new Set(out.map(propFillFingerprint));
  let periodCount = out.filter((p) => isCollegePeriodMarketPick(p)).length;
  if (periodCount >= periodSlots) return out;

  const remaining = () =>
    scored.filter((leg) => {
      if (!isCollegePeriodMarketPick(leg.pick)) return false;
      return !used.has(propFillFingerprint(leg.pick));
    });

  const pickNext = () => {
    const pool = remaining().sort((a, b) => {
      const rank = (b.rankScore ?? 0) - (a.rankScore ?? 0);
      if (rank !== 0) return rank;
      return propFillComposite(b.pick) - propFillComposite(a.pick);
    });
    return pool[0] ?? null;
  };

  while (periodCount < periodSlots) {
    const cand = pickNext();
    if (!cand) break;
    const fp = propFillFingerprint(cand.pick);
    const maxPerGame = maxLegsPerGame(target, legsPerGameCap);

    if (out.length < target) {
      if (wouldExceedMaxLegsPerGame(cand.pick, out, maxPerGame)) {
        used.add(fp);
        continue;
      }
      out = [...out, cand.pick];
    } else {
      // Prefer swapping a full-game non-prop leg (FG spread/ML/total).
      let worstIdx = -1;
      let worstScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (p.isProp) continue;
        if (isCollegePeriodMarketPick(p)) continue;
        const score = propFillComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
      }
      if (worstIdx < 0) break;
      const withoutWorst = out.filter((_, i) => i !== worstIdx);
      if (wouldExceedMaxLegsPerGame(cand.pick, withoutWorst, maxPerGame)) {
        used.add(fp);
        continue;
      }
      const next = out.slice();
      next[worstIdx] = cand.pick;
      out = next;
    }
    used.add(fp);
    periodCount += 1;
  }

  return out.slice(0, target);
}

/**
 * College mix: reserve posted team-total-points seats so FG spreads cannot
 * crowd out Team Total / Alt Team Total. Swaps lowest-ranked non-team-total
 * FG legs — never invents markets or prices.
 */
export function fillReservedTeamTotalSlots<T extends PropFillPick>(
  picks: T[],
  scored: PropFillLeg<T>[],
  target: number,
  legsPerGameCap?: number | null,
): T[] {
  if (target < 5) return picks.slice(0, Math.max(0, target));
  const seats = boardScanTeamTotalSlotCount(target);
  if (seats <= 0) return picks.slice(0, target);

  let out = picks.slice(0, target);
  const used = new Set(out.map(propFillFingerprint));
  let ttCount = out.filter((p) => isCollegeTeamTotalPick(p)).length;
  if (ttCount >= seats) return out;

  const remaining = () =>
    scored.filter((leg) => {
      if (!isCollegeTeamTotalPick(leg.pick)) return false;
      return !used.has(propFillFingerprint(leg.pick));
    });

  const pickNext = () => {
    const pool = remaining().sort((a, b) => {
      const rank = (b.rankScore ?? 0) - (a.rankScore ?? 0);
      if (rank !== 0) return rank;
      return propFillComposite(b.pick) - propFillComposite(a.pick);
    });
    return pool[0] ?? null;
  };

  while (ttCount < seats) {
    const cand = pickNext();
    if (!cand) break;
    const fp = propFillFingerprint(cand.pick);
    const maxPerGame = maxLegsPerGame(target, legsPerGameCap);

    if (out.length < target) {
      if (wouldExceedMaxLegsPerGame(cand.pick, out, maxPerGame)) {
        used.add(fp);
        continue;
      }
      out = [...out, cand.pick];
    } else {
      let worstIdx = -1;
      let worstScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (p.isProp) continue;
        if (isCollegeTeamTotalPick(p)) continue;
        // Prefer swapping FG spreads/totals over period seats already reserved.
        if (isCollegePeriodMarketPick(p)) continue;
        const score = propFillComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
      }
      if (worstIdx < 0) break;
      const withoutWorst = out.filter((_, i) => i !== worstIdx);
      if (wouldExceedMaxLegsPerGame(cand.pick, withoutWorst, maxPerGame)) {
        used.add(fp);
        continue;
      }
      const next = out.slice();
      next[worstIdx] = cand.pick;
      out = next;
    }
    used.add(fp);
    ttCount += 1;
  }

  return out.slice(0, target);
}

/**
 * Shortfall lead when props are still scoring — never claim the quality bar
 * alone exhausted the board (phone: reserved seats → "only 3 cleared").
 */
export function buildFixedLegPropsPendingShortfallLead(
  requested: number,
  actual: number,
): string {
  if (actual >= requested) return "";
  if (actual <= 0) {
    return `You asked for **${requested}** legs — prop scoring did not finish and no AI-backed picks cleared yet. No ungraded filler was added.`;
  }
  return `You asked for **${requested}** legs — only **${actual}** cleared so far while player props were still scoring. No ungraded filler was added.`;
}

/** Honest delivery note for fixed-leg shortfalls / incomplete prop scoring. */
export function buildFinalCoachParlayNote(opts: {
  target: number;
  picks: { isProp?: boolean; market?: string }[];
  propPoolSize: number;
  propsPending: boolean;
  shortfallLead: string;
  timedOut?: boolean;
  budgetMs?: number;
  scanMissing?: boolean;
  scanNote?: string;
  failureReason?: CoachScanFailureReason | null;
  failureDiagnostics?: CoachScanFailureDiagnostics;
  /** When true, never describe a game-line fallback (props-only asks). */
  propsOnly?: boolean;
  /**
   * Football mix asks ("10 leg nfl"): never claim we are "showing N game-line
   * picks" — GL-only finals are refused; note must say no filler was added.
   */
  requirePropMix?: boolean;
}): string {
  const propLike = countPropLikePicks(opts.picks);
  const propsPendingLead =
    opts.propPoolSize > 0 && propLike === 0 && opts.propsPending
      ? buildFixedLegPropsPendingShortfallLead(opts.target, opts.picks.length)
      : "";
  // Prefer the props-pending lead over a bare "quality bar" shortfall — seats
  // held / scoring cut short is not the same as the board failing the bar.
  const lead = propsPendingLead || opts.shortfallLead;
  const thinGameOnlyNote =
    !opts.propsOnly &&
    opts.picks.length > 0 &&
    opts.picks.length < opts.target &&
    propLike === 0 &&
    opts.propPoolSize > 0 &&
    !opts.propsPending
      ? opts.requirePropMix
        ? ` Player props did not clear the AI quality bar — showing ${opts.picks.length} game-line pick${opts.picks.length === 1 ? "" : "s"} that did. No ungraded filler was added.`
        : ` Scanned ${opts.propPoolSize} posted props/alts — none cleared the AI quality bar with these game lines.`
      : "";
  const propsIncompleteNote =
    // Pending lead already states the unfinished-props story — only append the
    // seat-hold / try-again detail for football mix (and props-only empty).
    // Full tickets need no "try again" suffix.
    opts.propPoolSize > 0 &&
    propLike === 0 &&
    opts.propsPending &&
    opts.picks.length < opts.target
      ? opts.propsOnly
        ? opts.picks.length > 0
          ? ` Showing ${opts.picks.length} prop${opts.picks.length === 1 ? "" : "s"} that cleared so far. Try again for the full props ticket.`
          : ` Loaded ${opts.propPoolSize} posted props/alts — try again for a props-only ticket (no game lines).`
        : opts.requirePropMix
          ? opts.picks.length > 0
            ? ` Holding reserved prop seats (${opts.picks.length} game-line pick${opts.picks.length === 1 ? "" : "s"} so far). Try again for a full props mix.`
            : ` Reserved prop seats stayed open (no full game-line fill). Try again.`
          : opts.picks.length > 0
            ? ` Try again for a full props mix.`
            : ` No game lines cleared either — try again.`
      : "";
  const mixRefusedNote =
    opts.requirePropMix &&
    opts.picks.length === 0 &&
    opts.propPoolSize > 0 &&
    !opts.propsPending
      ? ` Football mix found no AI-backed props or game lines that cleared.`
      : "";
  const emptyBoardNote =
    opts.picks.length === 0 && opts.scanMissing && !opts.timedOut
      ? ` Board scan did not return picks — try again.`
      : "";
  const base =
    (opts.scanNote?.trim() && opts.picks.length > 0 && propLike > 0 ? opts.scanNote.trim() : "") ||
    (lead
      ? `${lead}${thinGameOnlyNote}${propsIncompleteNote}${mixRefusedNote}`
      : "") ||
    propsIncompleteNote ||
    mixRefusedNote ||
    emptyBoardNote ||
    (opts.timedOut
      ? `Stopped at the ${Math.round((opts.budgetMs ?? 0) / 1000)}s delivery budget — showing every AI-backed pick that cleared so far.`
      : opts.picks.length
        ? ""
        : `No AI-backed picks cleared the quality bar for a ${opts.target}-leg ticket.`);

  // Empty tickets keep failureReason on the scan result / failureDiagnostics —
  // never append `[PROP_POOL_EMPTY: …]` (or any CODE:detail) into the Coach note.
  return sanitizeCoachUserNote(base);
}
