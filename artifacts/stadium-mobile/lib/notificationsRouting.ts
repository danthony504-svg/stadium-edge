import { SLIP_UI_ENABLED } from "./slipUi.ts";

export type NotifRouteData = { type?: string; buildId?: string } | undefined;

/** Pure route helper — shared by warm listener + cold-start last-response. */
export function routeForNotificationData(data: NotifRouteData): string {
  switch (data?.type) {
    case "dailyPicks":
      return "/props";
    case "result":
    case "reminder":
    case "oddsMovement":
      return SLIP_UI_ENABLED ? "/slip" : "/coach";
    case "upsetAlert":
      return "/";
    case "edgeLock":
      return "/arbitrage";
    case "coachReady":
      return data.buildId ? `/coach?buildId=${encodeURIComponent(data.buildId)}` : "/coach";
    default:
      return "/";
  }
}
