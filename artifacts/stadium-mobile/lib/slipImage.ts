// Saves a bet-slip image to the device Photos library.
//
// react-native-view-shot does NOT work in Expo Go, so we render the slip PNG
// server-side (api-server POST /api/slip-image, drawn with @napi-rs/canvas using
// ONLY the real legs/odds/stake we send up) and then write the returned base64
// PNG to the cache dir and hand it to the media library. expo-file-system v19's
// default API is the new file-handle one; the legacy import keeps the simple
// writeAsStringAsync(base64) call we rely on here.
import { fetch as expoFetch } from "expo/fetch";
import {
  EncodingType,
  cacheDirectory,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

import { API_BASE } from "@/lib/api";
import type { Leg } from "@/context/BetSlipContext";

export type SaveSlipResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "error" };

// POSTs the slip's real legs + stake to the server, which returns a rendered PNG
// (base64), then saves that PNG to the device's photo library. Returns a tagged
// result so the caller can show the right toast/alert.
export async function saveSlipToPhotos(legs: Leg[], stake: number): Promise<SaveSlipResult> {
  if (legs.length === 0) return { ok: false, reason: "error" };

  try {
    const res = await expoFetch(`${API_BASE}/slip-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legs: legs.map((l) => ({
          pick: l.pick,
          market: l.market,
          game: l.game,
          odds: l.odds,
        })),
        stake,
      }),
    });
    if (!res.ok) return { ok: false, reason: "error" };
    const data = (await res.json()) as { png?: string };
    if (!data.png) return { ok: false, reason: "error" };

    // Ask for write access to the photo library (saveToLibraryAsync only needs
    // add-only permission). Bail cleanly if the user declines.
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: "permission" };

    const uri = `${cacheDirectory}stadium-edge-slip-${Date.now()}.png`;
    await writeAsStringAsync(uri, data.png, { encoding: EncodingType.Base64 });
    await MediaLibrary.saveToLibraryAsync(uri);
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}
