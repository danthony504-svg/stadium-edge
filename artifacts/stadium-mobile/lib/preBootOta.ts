import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

/**
 * Apply a downloaded OTA before expo-router loads any screen modules.
 * Prevents mixed embedded→OTA reloads from eval'ing corrupt route bytecode.
 */
export async function applyPreBootOtaIfNeeded(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;

  if (latestContext?.isUpdatePending) {
    await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
    return;
  }

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;

    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew && !latestContext?.isUpdatePending) return;

    await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
  } catch {
    // Offline or Expo CDN hiccup — continue boot; in-app recovery will retry.
  }
}
