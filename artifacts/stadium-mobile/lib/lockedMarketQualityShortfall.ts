/**
 * User-facing shortfall copy when an explicit market lock graded real
 * candidates but fewer than requested cleared AI quality requirements.
 *
 * Copy/UI only — does not change selection, thresholds, or market lock.
 * Display names come from ExplicitMarketLockRule.label (canonical mapping).
 */

import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
import { matchExplicitMarketLocks } from "./explicitMarketLock.ts";

/**
 * Resolve the canonical lock label for an ask, or null when unlocked.
 * Uses EXPLICIT_MARKET_LOCK_RULES via matchExplicitMarketLocks — no second list.
 */
export function lockedMarketLabelForAsk(
  ask: string | null | undefined,
): string | null {
  const labels = matchExplicitMarketLocks(ask)?.labels;
  if (!labels?.length) return null;
  const label = String(labels[0] ?? "").trim();
  return label || null;
}

/**
 * Turn canonical lock label into "... picks" phrase.
 * Inflection only — not a parallel market catalog.
 */
export function lockedMarketPickPhrase(label: string): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "picks";
  // Combo labels (pts+reb+ast) / "combo props" read fine as-is.
  if (/\+|combo/i.test(raw)) return `${raw} picks`;

  const words = raw.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1]!;
  // Keep unit / invariant plurals from lock labels (yards, bases, …).
  if (/^(yards|bases|points|threes|odds)$/i.test(last)) {
    return `${raw} picks`;
  }
  if (/ies$/i.test(last)) {
    words[words.length - 1] = last.replace(/ies$/i, "y");
  } else if (/s$/i.test(last) && !/ss$/i.test(last) && last.length > 1) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return `${words.join(" ")} picks`;
}

export type LockedMarketQualityShortfallOpts = {
  /** Requested leg count (2–15). */
  requestedLegs: number;
  /** Props graded/analyzed in the locked market. */
  analyzed: number;
  /** Legs that cleared quality and are shown. */
  qualified: number;
  /** Human lock label from ExplicitMarketLockRule (e.g. "touchdowns"). */
  marketLabel: string;
};

/**
 * Honest shortfall note for locked-market underfills.
 * Returns "" when the ticket already met the requested count (N/N).
 * Distinguishes analyzed=0 (no candidates to grade) from analyzed>0 / qualified=0.
 */
export function lockedMarketQualityShortfallNote(
  opts: LockedMarketQualityShortfallOpts,
): string {
  const requested = Math.max(0, Math.floor(opts.requestedLegs));
  const analyzed = Math.max(0, Math.floor(opts.analyzed));
  const qualified = Math.max(0, Math.floor(opts.qualified));
  if (qualified >= requested && requested > 0) return "";

  const phrase = lockedMarketPickPhrase(opts.marketLabel);

  if (analyzed <= 0) {
    return (
      `I couldn't find any available ${phrase} for tonight that I could grade. ` +
      `I won't substitute another market just to fill your ${requested}-leg request.`
    );
  }

  if (qualified <= 0) {
    return (
      `I found and analyzed ${analyzed} ${phrase} for tonight, but none met Stadium Edge's quality standards. ` +
      `I won't add weaker picks just to fill your ${requested}-leg request.`
    );
  }

  if (qualified < requested) {
    return (
      `You asked for ${requested} ${phrase}. ` +
      `I found ${qualified} that met Stadium Edge's quality standards, ` +
      `so I'm showing ${qualified} instead of adding weaker picks.`
    );
  }

  return "";
}

export type ResolveCoachParlayShortfallLeadOpts = {
  askText: string;
  requestedLegs: number;
  /** Legs that cleared quality (ticket length). */
  qualified: number;
  /**
   * Real graded/evaluated count for the locked market pool.
   * Must not invent from unrelated board totals — pass diagnostics /
   * props-only propLegsScored for the already-allowlisted pool.
   */
  analyzed: number;
  isMarketLocked: boolean;
  /** Incomplete prop scoring — prefer pending copy over quality shortfall. */
  propsPending?: boolean;
  /** Pending-lead builder (injected so callers share boardScanPropDelivery). */
  buildPendingLead?: (requested: number, actual: number) => string;
};

/**
 * Full-board / hrBoardAsk analyzed count for locked shortfall copy.
 *
 * Uses `failureDiagnostics.propLegsScored` only. That count is lock-scoped
 * because `buildParlay` always passes an allowlisted (and for HR,
 * scorer-filtered) `activePropPool` with `skipPropPoolExpand` — the scanner
 * never re-expands into hits / total bases / strikeouts / etc.
 * Never substitutes `propPoolSize` or cross-market board totals.
 */
export function lockedMarketAnalyzedFromBoardDiagnostics(
  diagnostics:
    | { propLegsScored?: number | null | undefined }
    | null
    | undefined,
): number {
  return Math.max(0, Math.floor(Number(diagnostics?.propLegsScored ?? 0)));
}

/**
 * Final shortfall lead for both props-only/recovery and full-board/hrBoardAsk
 * exits. Copy routing only — does not change selection or hrBoardAsk.
 */
export function resolveCoachParlayShortfallLead(
  opts: ResolveCoachParlayShortfallLeadOpts,
): string {
  const requested = Math.max(0, Math.floor(opts.requestedLegs));
  const qualified = Math.max(0, Math.floor(opts.qualified));
  if (requested > 0 && qualified >= requested) return "";

  if (opts.propsPending) {
    return (
      opts.buildPendingLead?.(requested, qualified) ??
      buildFixedLegCountShortfallLead(requested, qualified)
    );
  }

  if (opts.isMarketLocked) {
    const label = lockedMarketLabelForAsk(opts.askText);
    if (label) {
      return lockedMarketQualityShortfallNote({
        requestedLegs: requested,
        analyzed: Math.max(0, Math.floor(opts.analyzed)),
        qualified,
        marketLabel: label,
      });
    }
  }

  return buildFixedLegCountShortfallLead(requested, qualified);
}
