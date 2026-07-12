import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";

export { coachTicketUpgraded } from "./coachTicketUpgrade.ts";

/** Local heads-up when 10k sim finishes — background only to avoid duplicate in-thread noise. */
export async function notifyCoachTicketOptimized(
  legCount: number,
  upgraded: boolean,
): Promise<void> {
  if (AppState.currentState === "active") return;
  if (Platform.OS === "web") return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: upgraded ? "Ticket upgraded" : "Ticket optimized",
        body: `Your ${legCount}-leg AI Coach ticket finished 10,000 simulations.`,
        data: { type: "coachOptimized" },
      },
      trigger: null,
    });
  } catch {
    // Permission denied or simulator — ignore.
  }
}
