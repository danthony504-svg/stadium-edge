/**
 * Preview-only Coach voice controls: tap-to-talk, stop, mute.
 * Fail-soft when Build 78 / IPA lacks expo-av + expo-speech.
 */

import Feather from "@expo/vector-icons/Feather";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { FONT } from "@/components/ui";
import { transcribeCoachVoiceAudio } from "@/lib/coachVoiceApi";
import {
  hasCoachVoiceRecordingNative,
  hasCoachVoiceSpeechNative,
  speakCoachVoiceSummary,
  startCoachVoiceRecording,
  stopCoachVoiceSpeech,
  type VoiceRecordingHandle,
} from "@/lib/coachVoiceNative";
import {
  resolveCoachVoiceAvailability,
  type CoachVoiceAvailability,
} from "@/lib/coachVoicePolicy";
import { buildEnergeticAnalystSummary } from "@/lib/coachVoiceSummary";
import { resolveOtaChannelForUi } from "@/lib/otaChannelUi";

export type CoachVoicePhase =
  | "idle"
  | "recording"
  | "transcribing"
  | "speaking"
  | "unavailable";

export type CoachVoiceControlsHandle = {
  /** Speak an energetic summary of a Coach reply (no-op when muted / unavailable). */
  speakResult: (reply: string, pickCount?: number) => void;
  /** Stop recording + speech. */
  stopAll: () => void;
  muted: boolean;
};

type Props = {
  /** Composer busy (Coach build in flight) — blocks new recordings. */
  disabled: boolean;
  /** Inject transcript into existing Coach send() pipeline. */
  onTranscript: (text: string) => void;
};

export const CoachVoiceControls = forwardRef<CoachVoiceControlsHandle, Props>(
  function CoachVoiceControls({ disabled, onTranscript }, ref) {
    const colors = useColors();
    const [muted, setMuted] = useState(false);
    const [phase, setPhase] = useState<CoachVoicePhase>("idle");
    const [status, setStatus] = useState<string | null>(null);
    const recordingRef = useRef<VoiceRecordingHandle | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const mutedRef = useRef(muted);
    mutedRef.current = muted;

    const availability: CoachVoiceAvailability = useMemo(
      () =>
        resolveCoachVoiceAvailability({
          isDev: typeof __DEV__ !== "undefined" && __DEV__,
          channel: resolveOtaChannelForUi(),
          hasRecordingNative: hasCoachVoiceRecordingNative(),
          hasSpeechNative: hasCoachVoiceSpeechNative(),
        }),
      [],
    );

    useEffect(() => {
      if (!availability.uiEnabled) return;
      if (!availability.nativeReady) {
        setPhase("unavailable");
        setStatus(availability.reason);
      }
    }, [availability]);

    const stopAll = useCallback(async () => {
      abortRef.current?.abort();
      abortRef.current = null;
      stopCoachVoiceSpeech();
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) {
        try {
          await rec.cancel();
        } catch {
          // ignore
        }
      }
      setPhase(availability.nativeReady ? "idle" : "unavailable");
    }, [availability.nativeReady]);

    const speakResult = useCallback(
      (reply: string, pickCount?: number) => {
        if (mutedRef.current) return;
        if (!availability.nativeReady || !hasCoachVoiceSpeechNative()) return;
        const summary = buildEnergeticAnalystSummary(reply, { pickCount });
        if (!summary.trim()) return;
        try {
          setPhase("speaking");
          setStatus(null);
          speakCoachVoiceSummary(summary);
        } catch (err) {
          setStatus(
            err instanceof Error ? err.message : "Could not speak result.",
          );
          setPhase("idle");
        }
      },
      [availability.nativeReady],
    );

    useImperativeHandle(
      ref,
      () => ({
        speakResult,
        stopAll: () => {
          void stopAll();
        },
        get muted() {
          return mutedRef.current;
        },
      }),
      [speakResult, stopAll],
    );

    const toggleRecord = useCallback(async () => {
      if (!availability.uiEnabled) return;
      if (!availability.nativeReady) {
        setStatus(availability.reason);
        return;
      }
      if (phase === "recording") {
        const rec = recordingRef.current;
        recordingRef.current = null;
        if (!rec) {
          setPhase("idle");
          return;
        }
        setPhase("transcribing");
        setStatus("Transcribing…");
        try {
          const uri = await rec.stopAndGetUri();
          if (!uri) throw new Error("No audio captured — try again.");
          const abort = new AbortController();
          abortRef.current = abort;
          const text = await transcribeCoachVoiceAudio(uri, {
            signal: abort.signal,
          });
          setPhase("idle");
          setStatus(null);
          onTranscript(text);
        } catch (err) {
          if (abortRef.current?.signal.aborted) {
            setPhase("idle");
            setStatus(null);
            return;
          }
          setPhase("idle");
          setStatus(
            err instanceof Error ? err.message : "Transcription failed.",
          );
        } finally {
          abortRef.current = null;
        }
        return;
      }

      if (disabled || phase === "transcribing") return;
      stopCoachVoiceSpeech();
      setStatus(null);
      try {
        const handle = await startCoachVoiceRecording();
        recordingRef.current = handle;
        setPhase("recording");
        setStatus("Listening… tap again to send");
      } catch (err) {
        setPhase("idle");
        setStatus(
          err instanceof Error ? err.message : "Could not start recording.",
        );
      }
    }, [
      availability.nativeReady,
      availability.reason,
      availability.uiEnabled,
      disabled,
      onTranscript,
      phase,
    ]);

    if (!availability.uiEnabled) return null;

    const micBusy = phase === "transcribing";
    const micActive = phase === "recording";

    return (
      <View style={{ alignItems: "center", gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable
            onPress={() => void toggleRecord()}
            disabled={micBusy || (disabled && !micActive)}
            accessibilityLabel={
              micActive ? "Stop recording and send" : "Tap to talk"
            }
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: micActive ? colors.primary : colors.card,
              borderWidth: micActive ? 0 : 1,
              borderColor: colors.border,
              opacity: pressed || micBusy || !availability.nativeReady ? 0.55 : 1,
            })}
          >
            {micBusy ? (
              <ActivityIndicator color={colors.mutedForeground} size="small" />
            ) : (
              <Feather
                name="mic"
                size={18}
                color={micActive ? "#fff" : colors.mutedForeground}
              />
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setMuted((m) => {
                const next = !m;
                if (next) stopCoachVoiceSpeech();
                return next;
              });
            }}
            accessibilityLabel={muted ? "Unmute spoken summaries" : "Mute spoken summaries"}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Feather
              name={muted ? "volume-x" : "volume-2"}
              size={16}
              color={colors.mutedForeground}
            />
          </Pressable>

          {(phase === "recording" ||
            phase === "transcribing" ||
            phase === "speaking") && (
            <Pressable
              onPress={() => void stopAll()}
              accessibilityLabel="Stop voice"
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather name="square" size={14} color={colors.foreground} />
            </Pressable>
          )}
        </View>
        {status ? (
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 11,
              color: colors.mutedForeground,
              maxWidth: 160,
              textAlign: "center",
            }}
            numberOfLines={2}
          >
            {status}
          </Text>
        ) : null}
      </View>
    );
  },
);
