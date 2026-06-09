// Refer-a-friend link helper.
//
// Each signed-in user gets a stable, shareable referral code derived
// deterministically from their account id, so the same user always produces the
// same code without needing any server-side referral registry. We never expose
// the raw account id — it's normalized into a short uppercase code.

// Derive a short, stable referral code from the account id. Returns null when
// there's no usable id (so callers can omit the feature rather than show a blank
// or fabricated code).
export function referralCodeFromUserId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  // Drop a Clerk-style "user_" prefix and any non-alphanumerics, then take a
  // short stable slice. The id is opaque/random, so the tail is a fine code.
  const cleaned = userId.replace(/^user_/i, "").replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return null;
  return cleaned.slice(-8).toUpperCase();
}

// Build the full referral link a user can share. `domain` is the app's real host
// (EXPO_PUBLIC_DOMAIN at runtime). Returns null when we can't build a real,
// openable link (no id or no domain) — never a fake/placeholder URL.
export function buildReferralLink(
  userId: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  const code = referralCodeFromUserId(userId);
  if (!code) return null;
  const host = (domain ?? "").trim();
  if (!host) return null;
  const base = /^https?:\/\//i.test(host)
    ? host.replace(/\/+$/, "")
    : `https://${host.replace(/\/+$/, "")}`;
  return `${base}/?ref=${code}`;
}
