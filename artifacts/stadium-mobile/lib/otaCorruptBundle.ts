/** Heuristics for JS bundle corruption from mixed embedded + OTA chunks. */
export function looksLikeCorruptOtaBundle(message: string | undefined | null): boolean {
  if (!message) return false;
  if (message.includes("doesn't exist")) return true;
  if (/fingerprint:\s*"/.test(message) && message.includes("domain:")) return true;
  if (message.includes("pick@/")) return true;
  return false;
}
