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
import { COACH_PRIORITY_SPORTS } from "./coachPrioritySports.ts";
import { maxLegsPerGame, wouldExceedMaxLegsPerGame } from "./parlayCorrelationScore.ts";

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

/** Prefer classic football skill props when filling reserved slots.
 * TD + pass/rec/rush yards (incl alt milestones) outrank sacks / misc.
 */
export function footballSkillPropRank(market: string | null | undefined): number {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  // Anytime / first / rush-rec-pass TDs — user asks for these first.
  if (/\btd\b|touchdown|\btds\b/.test(m)) return 6;
  // Yardage skill props (main + alternate ladders).
  if (/\bpass\b/.test(m) && /yd|yard/.test(m) && !/completion|attempt|int/.test(m)) return 5;
  if (/\breception|\breceiving|\brec\b/.test(m) && /yd|yard/.test(m)) return 5;
  if (/\brush\b|\brushing\b/.test(m) && /yd|yard/.test(m)) return 5;
  if (/\bsack/.test(m)) return 3;
  if (/\brush\b|\bpass\b|\breception|\breceiv/.test(m)) return 2;
  return 0;
}

/** Bucket classic football skill markets so reserved slots diversify (not 4× rush). */
export function footballSkillPropFamily(
  market: string | null | undefined,
): "sack" | "rush" | "pass" | "rec" | "td" | null {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  // TD before rush/pass/rec so player_rush_tds is "td", not "rush".
  if (/\btd\b|touchdown|\btds\b/.test(m)) return "td";
  if (/\bsack/.test(m)) return "sack";
  if (/\brush\b|\brushing\b/.test(m)) return "rush";
  if (/\bpass\b|\bpassing\b/.test(m) && !/completion/.test(m)) return "pass";
  if (/\breception|\breceiving|\brec\b/.test(m)) return "rec";
  return null;
}

/** Soft prefer classic alt rush milestones (25+ / 50+ / 75+ / 100+). */
export function footballRushMilestoneBonus(pick: {
  market?: string | null;
  propLine?: number | null;
  pick?: string | null;
}): number {
  if (footballSkillPropFamily(pick.market) !== "rush") return 0;
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
    const fam = footballSkillPropFamily(p.market);
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
      const aSkill = footballSkillPropRank(aKey) + footballRushMilestoneBonus(a.pick);
      const bSkill = footballSkillPropRank(bKey) + footballRushMilestoneBonus(b.pick);
      // Skill props first, then diversify families (td/pass/rec/rush), then rank.
      const aSkillful = aSkill > 0 ? 1 : 0;
      const bSkillful = bSkill > 0 ? 1 : 0;
      if (aSkillful !== bSkillful) return bSkillful - aSkillful;
      const aFam = footballSkillPropFamily(aKey);
      const bFam = footballSkillPropFamily(bKey);
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
    const fam = footballSkillPropFamily(cand.pick.propMarketKey || cand.pick.market);
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
