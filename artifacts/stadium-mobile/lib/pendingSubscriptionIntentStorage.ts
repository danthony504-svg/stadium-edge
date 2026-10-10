import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  PENDING_SUBSCRIPTION_INTENT_KEY,
  parseSubscriptionIntentJson,
  type SubscriptionIntent,
} from "./pendingSubscriptionIntent";

export async function savePendingSubscriptionIntent(
  intent: SubscriptionIntent,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PENDING_SUBSCRIPTION_INTENT_KEY,
      JSON.stringify(intent),
    );
  } catch {
    // Best-effort — URL params still carry returnTo on sign-in.
  }
}

export async function loadPendingSubscriptionIntent(): Promise<SubscriptionIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_SUBSCRIPTION_INTENT_KEY);
    return parseSubscriptionIntentJson(raw);
  } catch {
    return null;
  }
}

export async function clearPendingSubscriptionIntent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_SUBSCRIPTION_INTENT_KEY);
  } catch {
    // ignore
  }
}
