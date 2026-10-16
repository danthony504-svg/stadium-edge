/**
 * Client → server voice proxy. API keys stay on the server.
 * Audio is sent as base64 JSON (no multipart parser required on the API).
 */

import { EncodingType, readAsStringAsync } from "expo-file-system/legacy";

import { API_BASE } from "./apiBase.ts";
import { getAuthTokenGetter } from "./authToken.ts";
import { appVersionRequestHeaders } from "./appVersionGate.ts";

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...appVersionRequestHeaders(),
  };
  try {
    const getter = getAuthTokenGetter();
    const token = getter ? await getter() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // unauthenticated probe
  }
  return headers;
}

/** Upload recorded audio; server runs Whisper (or configured STT). */
export async function transcribeCoachVoiceAudio(
  uri: string,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const audioBase64 = await readAsStringAsync(uri, {
    encoding: EncodingType.Base64,
  });
  const name = uri.split("/").pop() || "coach-voice.m4a";
  const mimeType = name.endsWith(".wav")
    ? "audio/wav"
    : name.endsWith(".mp3")
      ? "audio/mpeg"
      : "audio/m4a";

  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/voice/stt`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      audioBase64,
      mimeType,
      filename: name,
    }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      errText.trim() || `Voice transcription failed (${res.status}).`,
    );
  }
  const json = (await res.json()) as { text?: string };
  const text = String(json.text ?? "").trim();
  if (!text) throw new Error("No speech detected — try again.");
  return text;
}

/** Optional server TTS when on-device speech is unavailable. */
export async function synthesizeCoachVoiceSpeech(
  text: string,
  opts?: { signal?: AbortSignal },
): Promise<{ audioBase64: string; mimeType: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/voice/tts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText.trim() || `Voice TTS failed (${res.status}).`);
  }
  const json = (await res.json()) as {
    audioBase64?: string;
    mimeType?: string;
  };
  const audioBase64 = String(json.audioBase64 ?? "").trim();
  if (!audioBase64) throw new Error("Empty TTS audio.");
  return {
    audioBase64,
    mimeType: String(json.mimeType ?? "audio/mpeg"),
  };
}
