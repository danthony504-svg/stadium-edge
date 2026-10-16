/**
 * Coach voice (tap-to-talk + spoken summaries) — preview / development only.
 * Production channel is hard-disabled regardless of other flags.
 */

import { normalizeOtaChannelName } from "./navMenuAuth.ts";

export type CoachVoiceAvailability = {
  /** Show voice controls in Coach UI. */
  uiEnabled: boolean;
  /** Native record/play modules present in this binary. */
  nativeReady: boolean;
  /** Why voice is unavailable (user-facing, short). */
  reason: string | null;
};

/**
 * Channel gate for Coach voice. Production always off.
 * Preview / development / __DEV__ may enable UI.
 */
export function shouldEnableCoachVoiceUi(opts: {
  isDev: boolean;
  channel?: string | null;
}): boolean {
  const ch = normalizeOtaChannelName(opts.channel);
  if (ch === "production" || ch === "prod") return false;
  if (opts.isDev) return true;
  return ch === "preview" || ch === "development";
}

export function resolveCoachVoiceAvailability(opts: {
  isDev: boolean;
  channel?: string | null;
  hasRecordingNative: boolean;
  hasSpeechNative: boolean;
}): CoachVoiceAvailability {
  if (!shouldEnableCoachVoiceUi(opts)) {
    return {
      uiEnabled: false,
      nativeReady: false,
      reason: "Voice Coach is preview-only (disabled on production).",
    };
  }
  if (!opts.hasRecordingNative || !opts.hasSpeechNative) {
    return {
      uiEnabled: true,
      nativeReady: false,
      reason:
        "Voice needs an updated preview app with microphone + speech support.",
    };
  }
  return { uiEnabled: true, nativeReady: true, reason: null };
}
