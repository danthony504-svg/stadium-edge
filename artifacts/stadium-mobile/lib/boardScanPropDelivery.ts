/**
 * Pure helpers for Coach board-scan prop delivery.
 * Kept free of api.ts so node:test can cover the 7-leg → 3 F5 latch without
 * loading the full scanner module graph.
 */

import {
  deriveCoachScanFailureReason,
  formatCoachScanFailureTrace,
  type CoachScanFailureReason,
  type CoachScanFailureDiagnostics,
} from "./coachScanFailureReason.ts";

/** ~50% of an N-leg ticket is reserved for player props (matches preview staging). */
export function boardScanPropSlotCount(targetLegs: number): number {
  if (targetLegs < 3) return 0;
  return Math.max(1, Math.round(targetLegs * 0.5));
}

/** Game-line preview capacity while prop slots are still reserved. */
export function boardScanNonPropPreviewCap(targetLegs: number): number {
  return Math.max(0, targetLegs - boardScanPropSlotCount(targetLegs));
}

/**
 * Preview-only gate: while game lines are scoring and no props have landed yet,
 * hold reserved prop slots open so we do not paint F5-only previews as the ticket.
 *
 * Never set this on a final result — that wiped cleared game lines to a 0-leg
 * "instant empty" ticket when prop scoring threw or timed out (#469 regression).
 * Final prop shortfalls use `propPhaseIncomplete` + honest notes instead.
 */
export function shouldKeepAwaitingPropSlots(opts: {
  preview?: boolean;
  propsOnly?: boolean;
  targetLegs: number;
  propCount: number;
  propPhaseIncomplete?: boolean;
}): boolean {
  if (opts.propsOnly || opts.targetLegs < 3) return false;
  if (!opts.preview) return false;
  const propSlots = boardScanPropSlotCount(opts.targetLegs);
  return opts.propCount < propSlots && opts.propCount === 0;
}

function countPropLikePicks(picks: { isProp?: boolean; market?: string }[]): number {
  return picks.filter((p) => p.isProp || /alt/i.test(p.market || "")).length;
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

/**
 * Prefer classic skill props across leagues when filling reserved slots.
 * Covers NFL/NCAAF, MLB, NBA/WNBA/NCAAB, NHL, and soccer — not football-only.
 */
export function skillPropRank(market: string | null | undefined): number {
  const m = String(market ?? "").toLowerCase();
  // Football
  if (/sack/.test(m)) return 5;
  if (/rush_yds|rushing|rush_attempt/.test(m)) return 5;
  if (/pass_yds|pass_td|passing/.test(m) && !/completion/.test(m)) return 4;
  if (/reception|rec_yds|receiving/.test(m)) return 4;
  if (/anytime_td|anytime touchdown|player_anytime_td/.test(m)) return 2;
  // MLB
  if (/pitcher_strikeout/.test(m)) return 5;
  if (/batter_home_runs|home_runs/.test(m)) return 5;
  if (/hits_runs_rbis/.test(m)) return 4;
  if (/total_bases/.test(m)) return 4;
  if (/batter_hits/.test(m)) return 3;
  if (/stolen_bases/.test(m)) return 3;
  // Basketball
  if (/points_rebounds_assists/.test(m)) return 4;
  if (/player_points/.test(m)) return 3;
  if (/player_rebounds|rebounds/.test(m)) return 3;
  if (/player_assists/.test(m)) return 3;
  if (/player_threes|threes/.test(m)) return 3;
  if (/player_steals|player_blocks|blocks_steals/.test(m)) return 2;
  // Hockey
  if (/player_goals/.test(m)) return 4;
  if (/shots_on_goal/.test(m)) return 3;
  if (/player_points/.test(m)) return 3;
  if (/player_assists/.test(m)) return 3;
  // Soccer
  if (/goal_scorer_anytime|anytime_goal/.test(m)) return 5;
  if (/shots_on_target/.test(m)) return 3;
  if (/player_shots/.test(m)) return 2;
  return 0;
}

/** @deprecated Prefer skillPropRank — kept for existing football call sites/tests. */
export function footballSkillPropRank(market: string | null | undefined): number {
  return skillPropRank(market);
}

export type SkillPropFamily =
  | "sack"
  | "rush"
  | "pass"
  | "rec"
  | "td"
  | "hits"
  | "hr"
  | "hrrbi"
  | "tb"
  | "sb"
  | "k"
  | "points"
  | "reb"
  | "ast"
  | "threes"
  | "pra"
  | "stocks"
  | "goals"
  | "assists"
  | "sog"
  | "skater_pts"
  | "anytime_goal"
  | "shots"
  | "sot";

/**
 * Bucket skill markets so reserved slots diversify across leagues
 * (not 4× rush, 4× points, or 4× hits).
 */
export function skillPropFamily(market: string | null | undefined): SkillPropFamily | null {
  const m = String(market ?? "").toLowerCase();
  // Football
  if (/sack/.test(m)) return "sack";
  if (/rush_yds|rushing|rush_attempt|rush_longest/.test(m)) return "rush";
  if (/pass_yds|pass_td|pass_attempt|pass_intercept|passing/.test(m) && !/completion/.test(m)) {
    return "pass";
  }
  if (/reception|rec_yds|receiving|rec_longest/.test(m)) return "rec";
  if (/anytime_td|anytime touchdown|player_anytime_td/.test(m)) return "td";
  // MLB
  if (/pitcher_strikeout/.test(m)) return "k";
  if (/batter_home_runs|home_runs/.test(m)) return "hr";
  if (/hits_runs_rbis/.test(m)) return "hrrbi";
  if (/total_bases/.test(m)) return "tb";
  if (/stolen_bases/.test(m)) return "sb";
  if (/batter_hits/.test(m)) return "hits";
  // Basketball (check combos / threes before bare points)
  if (/points_rebounds_assists/.test(m)) return "pra";
  if (/player_threes|threes/.test(m)) return "threes";
  if (/player_rebounds|rebounds/.test(m)) return "reb";
  if (/player_assists/.test(m)) return "ast";
  if (/player_steals|player_blocks|blocks_steals/.test(m)) return "stocks";
  if (/player_points/.test(m)) return "points";
  // Hockey — goals/SOG/assists before generic points key collisions are unlikely
  // because Odds keys are player_goals / player_shots_on_goal / player_points.
  if (/shots_on_goal/.test(m)) return "sog";
  if (/player_goals/.test(m)) return "goals";
  if (/player_assists/.test(m)) return "assists";
  // Soccer
  if (/goal_scorer_anytime/.test(m)) return "anytime_goal";
  if (/shots_on_target/.test(m)) return "sot";
  if (/player_shots/.test(m)) return "shots";
  return null;
}

/** @deprecated Prefer skillPropFamily — kept for existing football call sites/tests. */
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
): T[] {
  if (target < 3) return picks.slice(0, Math.max(0, target));
  const propSlots = boardScanPropSlotCount(target);
  if (propSlots <= 0) return picks.slice(0, target);

  let out = picks.slice(0, target);
  const used = new Set(out.map(propFillFingerprint));
  let propCount = out.filter((p) => !!p.isProp).length;

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
      const aSkill = skillPropRank(a.pick.market);
      const bSkill = skillPropRank(b.pick.market);
      // Skill props first, then diversify families across leagues, then rank.
      const aSkillful = aSkill > 0 ? 1 : 0;
      const bSkillful = bSkill > 0 ? 1 : 0;
      if (aSkillful !== bSkillful) return bSkillful - aSkillful;
      const aFam = skillPropFamily(a.pick.market);
      const bFam = skillPropFamily(b.pick.market);
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
    const fam = skillPropFamily(cand.pick.market);

    if (out.length < target) {
      out = [...out, cand.pick];
    } else {
      let worstIdx = -1;
      let worstScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (p.isProp) continue;
        const score = propFillComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
      }
      if (worstIdx < 0) break;
      const next = out.slice();
      next[worstIdx] = cand.pick;
      out = next;
    }
    used.add(fp);
    propCount += 1;
    if (fam) familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
  }

  // Even when prop slots are already full, swap concentrated skill families
  // (e.g. 4× rush or 4× hits) for underrepresented families when available.
  const maxPerFamily = Math.max(1, Math.ceil(propSlots / 3));
  let swaps = 0;
  while (swaps < propSlots) {
    let excessIdx = -1;
    let excessFam: string | null = null;
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!;
      if (!p.isProp) continue;
      const fam = skillPropFamily(p.market);
      if (!fam) continue;
      if ((familyCounts.get(fam) ?? 0) > maxPerFamily) {
        excessIdx = i;
        excessFam = fam;
        break;
      }
    }
    if (excessIdx < 0 || !excessFam) break;

    const cand = remaining()
      .filter((leg) => {
        const fam = skillPropFamily(leg.pick.market);
        if (!fam || fam === excessFam) return false;
        return (familyCounts.get(fam) ?? 0) < maxPerFamily;
      })
      .sort((a, b) => {
        const aSkill = skillPropRank(a.pick.market);
        const bSkill = skillPropRank(b.pick.market);
        if (aSkill !== bSkill) return bSkill - aSkill;
        return (b.rankScore ?? 0) - (a.rankScore ?? 0);
      })[0];
    if (!cand) break;

    const old = out[excessIdx]!;
    const oldFam = skillPropFamily(old.market);
    const newFam = skillPropFamily(cand.pick.market);
    const next = out.slice();
    next[excessIdx] = cand.pick;
    out = next;
    used.delete(propFillFingerprint(old));
    used.add(propFillFingerprint(cand.pick));
    if (oldFam) familyCounts.set(oldFam, Math.max(0, (familyCounts.get(oldFam) ?? 1) - 1));
    if (newFam) familyCounts.set(newFam, (familyCounts.get(newFam) ?? 0) + 1);
    swaps += 1;
  }

  return out.slice(0, target);
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
}): string {
  const propLike = countPropLikePicks(opts.picks);
  const thinGameOnlyNote =
    opts.picks.length > 0 &&
    opts.picks.length < opts.target &&
    propLike === 0 &&
    opts.propPoolSize > 0 &&
    !opts.propsPending
      ? ` Scanned ${opts.propPoolSize} posted props/alts — none cleared the AI quality bar with these game lines.`
      : "";
  const propsIncompleteNote =
    opts.propPoolSize > 0 && propLike === 0 && opts.propsPending
      ? opts.picks.length > 0
        ? ` Player props did not finish scoring — showing ${opts.picks.length} game-line pick${opts.picks.length === 1 ? "" : "s"} that cleared. Try again for a full props mix.`
        : ` Loaded ${opts.propPoolSize} posted props/alts but prop scoring did not finish and no game lines cleared — try again.`
      : "";
  const emptyBoardNote =
    opts.picks.length === 0 && opts.scanMissing && !opts.timedOut
      ? ` Board scan did not return picks — try again.`
      : "";
  const base =
    (opts.scanNote?.trim() && opts.picks.length > 0 && propLike > 0 ? opts.scanNote.trim() : "") ||
    (opts.shortfallLead
      ? `${opts.shortfallLead}${thinGameOnlyNote}${propsIncompleteNote}`
      : "") ||
    propsIncompleteNote ||
    emptyBoardNote ||
    (opts.timedOut
      ? `Stopped at the ${Math.round((opts.budgetMs ?? 0) / 1000)}s delivery budget — showing every AI-backed pick that cleared so far.`
      : opts.picks.length
        ? ""
        : `No AI-backed picks cleared the quality bar for a ${opts.target}-leg ticket.`);

  // Empty tickets must carry a machine-readable reason so phone empties are diagnosable.
  if (opts.picks.length > 0) return base;
  const reason =
    opts.failureReason ??
    deriveCoachScanFailureReason({
      ...(opts.failureDiagnostics ?? {}),
      scanMissing: opts.scanMissing,
      timedOut: opts.timedOut,
      stagedPickCount: opts.picks.length,
      propPoolSize: opts.failureDiagnostics?.propPoolSize ?? opts.propPoolSize,
      propPhaseIncomplete: opts.propsPending || opts.failureDiagnostics?.propPhaseIncomplete,
    });
  if (!reason) return base;
  if (base.includes(`[${reason.code}:`)) return base;
  return `${base}${formatCoachScanFailureTrace(reason)}`;
}
