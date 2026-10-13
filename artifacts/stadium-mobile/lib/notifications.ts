import Constants from "expo-constants";
import * as Device from "expo-device";
import type * as ExpoNotifications from "expo-notifications";
import { Platform } from "react-native";

import {
  getNotifPrefs,
  putNotifPrefs,
  registerPushToken,
  sendTestPush,
  unregisterPushToken,
  type NotifPrefs,
} from "./api";
import { routeForNotificationData, type NotifRouteData } from "./notificationsRouting.ts";

export { routeForNotificationData } from "./notificationsRouting.ts";

// Re-export the authed HTTP helpers under the names the settings UI consumes.
export type { NotifPrefs };
export {
  getNotifPrefs as getPrefs,
  putNotifPrefs as putPrefs,
  sendTestPush,
  unregisterPushToken as unregister,
};

type NotificationsModule = typeof ExpoNotifications;

let notificationsMod: NotificationsModule | null = null;
let handlerReady: Promise<void> | null = null;

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (notificationsMod) return notificationsMod;
  try {
    notificationsMod = await import("expo-notifications");
    return notificationsMod;
  } catch {
    return null;
  }
}

/** Install foreground handler after OTA gate — avoids import-time native crashes. */
export async function ensureNotificationsReady(): Promise<boolean> {
  if (!handlerReady) {
    handlerReady = (async () => {
      const Notifications = await loadNotifications();
      if (!Notifications) return;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    })();
  }
  await handlerReady;
  return notificationsMod != null;
}

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
  if (!(await ensureNotificationsReady())) return null;

  const Notifications = notificationsMod!;

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

/**
 * Best-effort detach of the device push token from the signed-out account.
 * Call before/after Clerk signOut so the next account does not inherit pushes.
 */
export async function unregisterCurrentPushToken(): Promise<void> {
  if (!(await ensureNotificationsReady())) return;
  const Notifications = notificationsMod!;
  if (!Device.isDevice) return;
  try {
    const res = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    const token = res?.data;
    if (!token) return;
    await unregisterPushToken(token);
  } catch {
    // Ignore — sign-out must continue even if unregister fails.
  }
}

// Current OS-level permission status (granted / denied / undetermined). Used by
// the settings screen to surface a "denied — open Settings" hint.
export async function getPermissionStatus(): Promise<ExpoNotifications.PermissionStatus> {
  if (!(await ensureNotificationsReady())) return "undetermined" as ExpoNotifications.PermissionStatus;
  const { status } = await notificationsMod!.getPermissionsAsync();
  return status;
}

type NavFn = (path: string) => void;

// Deep-link a notification tap to the right screen based on data.type. Falls
// back to home for unknown/absent types. Returns the subscription so the caller
// can clean it up. Also drains the cold-start last response (terminated → tap).
export async function addNotificationResponseListener(
  navigate: NavFn,
): Promise<{ remove: () => void } | null> {
  if (!(await ensureNotificationsReady())) return null;

  const Notifications = notificationsMod!;

  const deliver = (response: ExpoNotifications.NotificationResponse | null | undefined) => {
    if (!response) return;
    const data = response.notification.request.content.data as NotifRouteData;
    navigate(routeForNotificationData(data));
  };

  // Cold start: app was terminated; user tapped a notification to open it.
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    deliver(last);
  } catch {
    // ignore
  }

  return Notifications.addNotificationResponseReceivedListener((response) => {
    deliver(response);
  });
}
