/**
 * Coach photo upload helpers — max 3 slip/screenshot attachments for vision
 * analysis. Pure regexes stay Node-testable; picker/manipulate stays in coach.tsx.
 */

/** Hard cap — must match api-server chat.ts MAX_IMAGES. */
export const MAX_COACH_IMAGES = 3;

const DO_BETTER_RE =
  /\b(?:do|doing|does|did)\s+(?:any\s+|it\s+|this\s+|that\s+)?bett?er\b/i;
const IMPROVE_COMPARISON_RE =
  /\b(which|what(?:'s| is| are)?|compare|versus|\bvs\.?\b|rank)\b[^\n]{0,40}\bbett?er\b/i;
const IMPROVE_SLIP_RE =
  /\b(?:bett?er|batter)\s+(one|ticket|slip|version|card|option|parlay)\b|\bmake (?:it|this|that|the (?:ticket|slip|parlay|card|bet)) (?:better|stronger|cleaner|safer|tighter|less correlated)\b|\bimprove\b[^\n]{0,18}\b(this|that|it|ticket|slip|parlay|card|legs?)\b|\b(?:fix|tighten|trim|diversif\w*|de-?correlate|clean up)\b[^\n]{0,18}\b(this|that|it|ticket|slip|parlay|card|legs?)\b/i;

/** Mirror of server improveWording — used to re-attach the last slip photo. */
export function wantsImproveSlip(text: string): boolean {
  if (DO_BETTER_RE.test(text)) return true;
  return IMPROVE_SLIP_RE.test(text) && !IMPROVE_COMPARISON_RE.test(text);
}

const ANALYZE_SLIP_RE =
  /\b(?:analy[sz]e|break\s*down|grade|rate|review|assess|evaluate|critique|check)\b[^\n]{0,24}\b(?:this|that|it|my|the|ticket|slip|parlay|card|bet|bets|legs?)\b|\b(?:thoughts on|how (?:good|bad|strong|risky))\b[^\n]{0,24}\b(?:ticket|slip|parlay|card|bet|bets|legs?)\b/i;

/** Read-only critique intent (no PICK rebuild). */
export function wantsAnalyzeSlip(text: string): boolean {
  return ANALYZE_SLIP_RE.test(text) && !wantsImproveSlip(text);
}

/**
 * Photo-only (or photo + light ask) → skip board-scan / odds fan-out and stream
 * straight to vision. Improve-from-photo still needs odds for rebuild PICK lines.
 * A photo always owns the turn — never fall into board scan while images are attached.
 */
export function isSlipPhotoVisionOnly(opts: {
  hasImages: boolean;
  text: string;
}): boolean {
  if (!opts.hasImages) return false;
  if (wantsImproveSlip(opts.text)) return false;
  return true;
}
