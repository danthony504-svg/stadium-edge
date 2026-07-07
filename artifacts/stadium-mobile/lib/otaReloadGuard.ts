import AsyncStorage from "@react-native-async-storage/async-storage";

const RELOAD_ATTEMPTS_KEY = "stadium-ota-reload-attempts";

export async function readColdStartReloadAttempts(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RELOAD_ATTEMPTS_KEY);
    const n = parseInt(raw ?? "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function bumpColdStartReloadAttempts(): Promise<void> {
  try {
    const n = await readColdStartReloadAttempts();
    await AsyncStorage.setItem(RELOAD_ATTEMPTS_KEY, String(n + 1));
  } catch {
    // Best-effort
  }
}

export async function clearColdStartReloadAttempts(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RELOAD_ATTEMPTS_KEY);
  } catch {
    // Best-effort
  }
}
