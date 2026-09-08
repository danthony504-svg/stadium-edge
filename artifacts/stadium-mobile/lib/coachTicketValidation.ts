/** Minimal Coach ticket leg validation — no React or PickCard imports. */

export type CoachPickShape = {
  game?: string;
  market?: string;
  pick?: string;
  odds?: number;
};

export function isValidCoachPick(pick: CoachPickShape | null | undefined): pick is Required<
  Pick<CoachPickShape, "game" | "market" | "pick" | "odds">
> & { odds: number } {
  if (!pick || typeof pick !== "object") return false;
  if (!pick.game?.trim() || !pick.market?.trim() || !pick.pick?.trim()) return false;
  return typeof pick.odds === "number" && Number.isFinite(pick.odds);
}

export function filterValidCoachPicks<T extends CoachPickShape>(picks: readonly T[]): T[] {
  return picks.filter(isValidCoachPick);
}
