/**
 * Coach voice proxies — STT (Whisper) + optional TTS.
 * API keys stay server-side via resolveOpenAIConfig(). Preview clients call these;
 * production app channel keeps voice UI disabled.
 */

import { Router, type IRouter, type Request } from "express";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/sports.js";
import { resolveOpenAIConfig } from "../lib/openaiConfig.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const sttLimiter = rateLimit({ windowMs: 60_000, max: 30, name: "voice-stt" });
const ttsLimiter = rateLimit({ windowMs: 60_000, max: 30, name: "voice-tts" });

const MAX_AUDIO_BASE64_CHARS = 4_000_000; // ~3MB decoded
const MAX_TTS_CHARS = 800;

function voiceUserId(req: Request): string | null {
  try {
    return getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

function openAIClient(): OpenAI | { error: string } {
  const config = resolveOpenAIConfig();
  if ("error" in config) return { error: config.error };
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

router.use("/voice/stt", sttLimiter);
router.use("/voice/tts", ttsLimiter);

/**
 * POST /api/voice/stt
 * Body: { audioBase64: string, mimeType?: string, filename?: string }
 * → { text: string }
 */
router.post("/voice/stt", async (req, res): Promise<void> => {
  const userId = voiceUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }

  const body = (req.body ?? {}) as {
    audioBase64?: unknown;
    mimeType?: unknown;
    filename?: unknown;
  };
  const audioBase64 =
    typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  if (!audioBase64) {
    res.status(400).json({ error: "audioBase64 required" });
    return;
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    res.status(413).json({ error: "audio too large" });
    return;
  }

  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : "audio/m4a";
  const filename =
    typeof body.filename === "string" && body.filename.trim()
      ? body.filename.trim()
      : "coach-voice.m4a";

  const clientOrErr = openAIClient();
  if ("error" in clientOrErr) {
    res.status(502).json({ error: clientOrErr.error });
    return;
  }

  try {
    const buf = Buffer.from(audioBase64, "base64");
    if (buf.length < 32) {
      res.status(400).json({ error: "audio too short" });
      return;
    }
    // OpenAI SDK accepts File / Blob in Node 20+.
    const file = new File([buf], filename, { type: mimeType });
    const result = await clientOrErr.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "en",
    });
    const text = String(result.text ?? "").trim();
    res.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "transcription failed";
    logger.warn({ err: message, userId }, "voice/stt failed");
    res.status(502).json({ error: "Voice transcription failed." });
  }
});

/**
 * POST /api/voice/tts
 * Body: { text: string }
 * → { audioBase64: string, mimeType: "audio/mpeg" }
 * Optional fallback when on-device speech is unavailable; primary path is expo-speech.
 */
router.post("/voice/tts", async (req, res): Promise<void> => {
  const userId = voiceUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }

  const body = (req.body ?? {}) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "text required" });
    return;
  }
  const clipped = text.slice(0, MAX_TTS_CHARS);

  const clientOrErr = openAIClient();
  if ("error" in clientOrErr) {
    res.status(502).json({ error: clientOrErr.error });
    return;
  }

  try {
    // tts-1 is widely available on OPENAI_API_KEY; energy comes from the
    // client-side analyst summary text (buildEnergeticAnalystSummary).
    const speech = await clientOrErr.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: clipped,
      response_format: "mp3",
    });
    const ab = await speech.arrayBuffer();
    const audioBase64 = Buffer.from(ab).toString("base64");
    res.json({ audioBase64, mimeType: "audio/mpeg" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "tts failed";
    logger.warn({ err: message, userId }, "voice/tts failed");
    res.status(502).json({ error: "Voice speech synthesis failed." });
  }
});

export default router;
