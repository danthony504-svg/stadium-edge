import { fetch as expoFetch } from "expo/fetch";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "./apiBase";
import { getAuthTokenGetter } from "./authToken";
import { appVersionRequestHeaders } from "./appVersionGate";
import { normalizeReferralCode, validPendingInvite } from "./referral";
const PENDING = "@stadium/pending-invite-v1";
export type ReferralStatus = {
  code: string;
  link: string;
  verifiedFriends: number;
  canApplyInvite: boolean;
  milestones: { count: number; label: string; claimed: boolean }[];
};
export class ReferralRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function request<T>(
  path: string,
  expectedUserId: string,
  body?: object,
): Promise<T> {
  const token = await getAuthTokenGetter()?.();
  if (!expectedUserId || !token)
    throw new ReferralRequestError("Sign in to use referrals.", 401);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const res = await expoFetch(`${API_BASE}/referrals/${path}`, {
      method: body ? "POST" : "GET",
      signal: abort.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Referral-User": expectedUserId,
        Authorization: `Bearer ${token}`,
        ...appVersionRequestHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok)
      throw new ReferralRequestError(
        typeof data.error === "string"
          ? data.error
          : "Referrals are temporarily unavailable.",
        res.status,
      );
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
export const getReferralStatus = (userId: string) =>
  request<ReferralStatus>("me", userId);
export const applyReferral = (userId: string, code: string) =>
  request<{ accepted: boolean }>("apply", userId, { code });
export const claimReferralReward = (userId: string, milestone: number) =>
  request<{ redemptionUrl: string; expiresAt: string }>("claim", userId, {
    milestone,
  });
export async function savePendingInvite(code: unknown): Promise<boolean> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return false;
  const existing = await loadPendingInvite();
  // First touch survives auth navigation and accidental repeat link opens.
  if (!existing)
    await AsyncStorage.setItem(
      PENDING,
      JSON.stringify({ code: normalized, at: Date.now() }),
    );
  return true;
}
export async function loadPendingInvite() {
  const raw = await AsyncStorage.getItem(PENDING);
  try {
    const value = raw ? validPendingInvite(JSON.parse(raw)) : null;
    if (raw && !value) await AsyncStorage.removeItem(PENDING);
    return value;
  } catch {
    await AsyncStorage.removeItem(PENDING);
    return null;
  }
}
export const clearPendingInvite = () => AsyncStorage.removeItem(PENDING);
