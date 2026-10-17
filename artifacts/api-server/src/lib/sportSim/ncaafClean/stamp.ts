/**
 * Clean research-only NCAAF engine stamp.
 * Never the live client stamp. Never flips NCAAF_GAME_LINE_SIM_VALIDATED.
 */

export const NCAAF_CLEAN_ENGINE_STAMP = "ncaaf-score-margin-v1-research" as const;

export type NcaafCleanEngineStamp = typeof NCAAF_CLEAN_ENGINE_STAMP;

/** Opt-in only — defaults off. */
export function ncaafCleanEngineResearchEnabled(flag?: boolean | null): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  const env = String(process.env.NCAAF_CLEAN_ENGINE_RESEARCH ?? "")
    .trim()
    .toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}
