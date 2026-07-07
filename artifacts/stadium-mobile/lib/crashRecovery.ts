import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_BOOT_CRASH_KEY = "stadium-last-boot-crash";

/** Hermes errors from corrupt / partial OTA bundles — kept dependency-free for early boot. */
export function isKnownCorruptCrashMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("getoddsselector")) return true;
  if (m.includes("tabletennis")) return true;
  if (m.includes("userfound is not a function")) return true;
  if (/property ['"]?tabletennis['"]? doesn't exist/i.test(message)) return true;
  if (/cannot read property ['"]?getoddsselector['"]? of undefined/i.test(message)) return true;
  return false;
}

export async function recordBootCrash(message: string): Promise<void> {
  if (!message || !isKnownCorruptCrashMessage(message)) return;
  try {
    await AsyncStorage.setItem(LAST_BOOT_CRASH_KEY, message.slice(0, 500));
  } catch {
    // Best-effort
  }
}

export async function readLastBootCrash(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_BOOT_CRASH_KEY);
  } catch {
    return null;
  }
}

export async function clearLastBootCrash(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_BOOT_CRASH_KEY);
  } catch {
    // Best-effort
  }
}
