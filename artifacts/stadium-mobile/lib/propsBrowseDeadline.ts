import { runCoachBounded, CoachWorkTimeout } from "./coachAbortable.ts";

export const PROPS_PAGE_BUDGET_MS = 18_000;
export const PROPS_EVENT_BUDGET_MS = 10_000;
export const PROPS_OPTIONAL_IDS_BUDGET_MS = 1_500;

/** Bound the entire browse operation, including dependencies that ignore abort. */
export async function propsBrowseDeadline<T>(work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal, budgetMs = PROPS_PAGE_BUDGET_MS): Promise<T> {
  try { return await runCoachBounded(work, budgetMs, parent); }
  catch (error) {
    if (error instanceof CoachWorkTimeout) {
      const phase = budgetMs === PROPS_OPTIONAL_IDS_BUDGET_MS ? "optional_team_ids" : budgetMs === PROPS_EVENT_BUDGET_MS ? "event_props" : "browse_page";
      console.warn("[props-browse] deadline", { phase, budgetMs });
      throw new Error("Player props request timed out. Try again.");
    }
    throw error;
  }
}
