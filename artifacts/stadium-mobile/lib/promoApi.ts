import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";

import { API_BASE } from "./apiBase";
import { getAuthTokenGetter } from "./authToken";

const DEVICE_ID_KEY = "stadium-edge:promo-device-id:v1";

/** Stable per-install id so guests can redeem server promos. */
export async function getOrCreatePromoDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 8) return existing;
  } catch {
    // fall through
  }
  const id =
    typeof Crypto.randomUUID === "function"
      ? Crypto.randomUUID()
      : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // still return ephemeral id for this session
  }
  return id;
}

export type ServerPromoUnlock = {
  code: string;
  label: string;
  lifetime: boolean;
  expiresAt: string | null;
  active: boolean;
};

export type PromoRedeemResponse =
  | {
      ok: true;
      alreadyRedeemed?: boolean;
      unlock: ServerPromoUnlock;
    }
  | {
      ok: false;
      reason?: string;
      error: string;
    };

async function promoFetch(
  path: string,
  init?: { method?: string; body?: string },
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    const getter = getAuthTokenGetter();
    const token = getter ? await getter() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // guest redeem with deviceId only
  }
  return expoFetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  }) as unknown as Promise<Response>;
}

export async function validatePromoCode(code: string): Promise<PromoRedeemResponse> {
  const res = await promoFetch("/promo/validate", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  return (await res.json()) as PromoRedeemResponse;
}

export async function redeemPromoCodeOnServer(code: string): Promise<PromoRedeemResponse> {
  const deviceId = await getOrCreatePromoDeviceId();
  const res = await promoFetch("/promo/redeem", {
    method: "POST",
    body: JSON.stringify({ code, deviceId }),
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  return (await res.json()) as PromoRedeemResponse;
}

export async function fetchServerPromoEntitlement(): Promise<ServerPromoUnlock | null> {
  const deviceId = await getOrCreatePromoDeviceId();
  const res = await promoFetch(`/promo/entitlement?deviceId=${encodeURIComponent(deviceId)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { ok?: boolean; unlock?: ServerPromoUnlock | null };
  return json.unlock ?? null;
}
