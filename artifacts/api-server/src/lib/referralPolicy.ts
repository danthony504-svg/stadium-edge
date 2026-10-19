import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

export const REFERRAL_MILESTONES = [
  { count: 3, label: "1 free week" },
  { count: 10, label: "1 free month" },
] as const;
export const APP_STORE_ID = "6776024127";
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
export const normalizeReferralCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{8,24}$/.test(code) ? code : null;
};
export const legacyReferralCode = (userId: string) =>
  normalizeReferralCode(
    userId
      .replace(/^user_/i, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-8),
  );
export const newReferralCode = () =>
  randomBytes(9).toString("hex").toUpperCase();

export function referralKey(): Buffer {
  const value = process.env.REFERRAL_REWARDS_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Referral rewards are not configured.");
  return Buffer.from(value, "hex");
}
export function referralProgramEnabled(): boolean {
  if (process.env.REFERRAL_PROGRAM_ENABLED !== "true") return false;
  try {
    referralKey();
    return true;
  } catch {
    return false;
  }
}
export function canonicalReferralEmail(email: string): string {
  const [local, host] = email.trim().toLowerCase().split("@");
  if (!local || !host) throw new Error("A verified email is required.");
  if (host === "gmail.com" || host === "googlemail.com")
    return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
  return `${local}@${host}`;
}
export function referralEmailHash(email: string): string {
  return createHmac("sha256", referralKey())
    .update(`referral-email:v1:${canonicalReferralEmail(email)}`)
    .digest("hex");
}
export function isNewReferralAccount(
  createdAt: number,
  now = Date.now(),
): boolean {
  return (
    Number.isFinite(createdAt) &&
    createdAt <= now &&
    createdAt >= now - 7 * 86400000
  );
}
export function encryptOffer(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", referralKey(), iv);
  const bytes = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decryptOffer(value: string): string {
  const [iv, tag, bytes] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", referralKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(bytes), cipher.final()]).toString("utf8");
}
export const offerHash = (code: string) =>
  createHash("sha256").update(code).digest("hex");
export const redemptionUrl = (code: string) =>
  `https://apps.apple.com/redeem?ctx=offercodes&id=${APP_STORE_ID}&code=${encodeURIComponent(code)}`;
