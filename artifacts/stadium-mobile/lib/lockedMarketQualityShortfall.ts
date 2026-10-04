/**
 * User-facing shortfall copy when an explicit market lock graded real
 * candidates but fewer than requested cleared AI quality requirements.
 *
 * Copy/UI only — does not change selection, thresholds, or market lock.
 */

/** Turn lock label ("touchdowns") into pick phrase ("touchdown picks"). */
export function lockedMarketPickPhrase(label: string): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "picks";
  const words = raw.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1]!;
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
 * Returns "" when there is nothing useful to say (no analyzed candidates).
 */
export function lockedMarketQualityShortfallNote(
  opts: LockedMarketQualityShortfallOpts,
): string {
  const requested = Math.max(0, Math.floor(opts.requestedLegs));
  const analyzed = Math.max(0, Math.floor(opts.analyzed));
  const qualified = Math.max(0, Math.floor(opts.qualified));
  if (analyzed <= 0) return "";

  const phrase = lockedMarketPickPhrase(opts.marketLabel);

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
