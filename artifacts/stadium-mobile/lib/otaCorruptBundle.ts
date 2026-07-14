/** Heuristics for JS bundle corruption from mixed embedded + OTA chunks. */
export function looksLikeCorruptOtaBundle(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes("doesn't exist")) return true;
  if (/fingerprint:\s*"/i.test(message) && message.includes("domain:")) return true;
  if (message.includes("pick@/")) return true;
  // Garbled native-module paths from mixed chunks (pushNotifications/update, pickBreadHicks/update, etc.)
  if (/[a-z]+\/update/i.test(message)) return true;
  if (/property\s+'[^']*\/[^']*'\s+doesn't exist/i.test(message)) return true;
  // Hermes failed to resolve a Metro module id — mixed/corrupt OTA chunk on device.
  if (/requiring module/i.test(m)) return true;
  if (/unknown module/i.test(m)) return true;
  return false;
}
