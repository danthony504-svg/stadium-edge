// Invite codes are issued and registered by the server, never derived on-device.
export const APP_STORE_INVITE_URL = "https://apps.apple.com/app/id6776024127";
export const normalizeReferralCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{8,24}$/.test(code) ? code : null;
};
export function buildReferralLink(
  code: unknown,
  domain: string | null | undefined,
): string | null {
  const normalized = normalizeReferralCode(code);
  if (!normalized || !domain?.trim()) return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(domain) ? domain : `https://${domain}`,
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return `${url.origin}/invite/${normalized}`;
  } catch {
    return null;
  }
}
export function validPendingInvite(
  value: unknown,
  now = Date.now(),
): { code: string; at: number } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { code?: unknown; at?: unknown };
  const code = normalizeReferralCode(v.code);
  return code &&
    typeof v.at === "number" &&
    Number.isFinite(v.at) &&
    v.at <= now &&
    now - v.at < 7 * 86400000
    ? { code, at: v.at }
    : null;
}
