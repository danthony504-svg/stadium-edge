import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  getNotifPrefs,
  putNotifPrefs,
  registerPushToken,
  sendTestPush,
  unregisterPushToken,
  type NotifPrefs,
} from "./api";

// Re-export the authed HTTP helpers under the names the settings UI consumes.
export type { NotifPrefs };
export {
  getNotifPrefs as getPrefs,
  putNotifPrefs as putPrefs,
  sendTestPush,
  unregisterPushToken as unregister,
};

// Foreground behavior: still show the banner + play a sound when a push lands
// while the app is open (otherwise iOS suppresses in-app notifications). Set at
// module load so it's registered before any notification can arrive.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// EAS project id is required to mint an Expo push token. Read from the static
// app.json (extra.eas.projectId); fall back to the known id as a safety net.
const PROJECT_ID =
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId ?? "9af36ab9-f953-4879-9dd2-82807ef7430c";

// Acquire (or confirm) notification permission, mint an Expo push token, and
// register it with the signed-in user's account. Returns the token, or null when
// push isn't available (simulator/web, denied permission, or a token failure).
// Safe to call repeatedly — the server upserts by token.
export async function registerForPushAsync(): Promise<string | null> {
  // Push tokens only exist on real hardware (also false on web).
  if (!Device.isDevice) return null;

  // Android requires a channel before notifications will display.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  let token: string;
  try {
    const res = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    token = res.data;
  } catch {
    return null;
  }

  try {
    await registerPushToken(token, Platform.OS);
  } catch {
    // Server registration failed (e.g. auth token not ready yet) — the token is
    // still valid locally; a later call will re-register it.
  }
  return token;
}

// Current OS-level permission status (granted / denied / undetermined). Used by
// the settings screen to surface a "denied — open Settings" hint.
export async function getPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

type NavFn = (path: string) => void;

// Deep-link a notification tap to the right screen based on data.type. Falls
// back to home for unknown/absent types. Returns the subscription so the caller
// can clean it up.
export function addNotificationResponseListener(
  navigate: NavFn,
): ReturnType<typeof Notifications.addNotificationResponseReceivedListener> {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { type?: string; buildId?: string }
      | undefined;
    // Must mirror the `data.type` values the backend sends (see notifyJobs.ts
    // and the /chat background-finish path):
    // "dailyPicks" | "result" | "reminder" | "oddsMovement" | "upsetAlert"
    // | "edgeLock" | "coachReady" | "test".
    switch (data?.type) {
      case "dailyPicks":
        navigate("/props");
        break;
      case "result":
      case "reminder":
      case "oddsMovement":
        navigate("/slip");
        break;
      case "upsetAlert":
        // Upset Watch card lives on the home screen.
        navigate("/");
        break;
      case "edgeLock":
        // The Edge Lock screen (route file stays `arbitrage`).
        navigate("/arbitrage");
        break;
      case "coachReady":
        // The AI Coach finished a parlay the user walked away from. Open Coach
        // with the buildId so it can load + replay the stashed finished ticket.
        navigate(data.buildId ? `/coach?buildId=${encodeURIComponent(data.buildId)}` : "/coach");
        break;
      default:
        navigate("/");
    }
  });
}
