/**
 * Fail-soft native bridge for Coach voice.
 * Build 78 / existing IPA lack expo-av + expo-speech — never crash on require.
 */

export type VoiceRecordingHandle = {
  stopAndGetUri: () => Promise<string | null>;
  cancel: () => Promise<void>;
};

type SpeechMod = {
  speak: (text: string, opts?: Record<string, unknown>) => void;
  stop: () => void;
  isSpeakingAsync?: () => Promise<boolean>;
};

type AvMod = {
  Audio: {
    requestPermissionsAsync: () => Promise<{ status: string }>;
    setAudioModeAsync: (mode: Record<string, unknown>) => Promise<void>;
    Recording: new () => {
      prepareToRecordAsync: (opts?: unknown) => Promise<void>;
      startAsync: () => Promise<void>;
      stopAndUnloadAsync: () => Promise<void>;
      getURI: () => string | null;
    };
    RecordingOptionsPresets?: { HIGH_QUALITY?: unknown };
  };
};

let speechMod: SpeechMod | null | undefined;
let avMod: AvMod | null | undefined;

export function resetCoachVoiceNativeForTests(): void {
  speechMod = undefined;
  avMod = undefined;
}

export function setCoachVoiceNativeForTests(opts: {
  speech?: SpeechMod | null;
  av?: AvMod | null;
}): void {
  if ("speech" in opts) speechMod = opts.speech;
  if ("av" in opts) avMod = opts.av;
}

function loadSpeech(): SpeechMod | null {
  if (speechMod !== undefined) return speechMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech") as SpeechMod;
    speechMod = mod?.speak ? mod : null;
  } catch {
    speechMod = null;
  }
  return speechMod;
}

function loadAv(): AvMod | null {
  if (avMod !== undefined) return avMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-av") as AvMod;
    avMod = mod?.Audio?.Recording ? mod : null;
  } catch {
    avMod = null;
  }
  return avMod;
}

export function hasCoachVoiceRecordingNative(): boolean {
  return loadAv() != null;
}

export function hasCoachVoiceSpeechNative(): boolean {
  return loadSpeech() != null;
}

export async function startCoachVoiceRecording(): Promise<VoiceRecordingHandle> {
  const av = loadAv();
  if (!av) {
    throw new Error("Recording native module unavailable in this app build.");
  }
  const perm = await av.Audio.requestPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error("Microphone permission is required for tap-to-talk.");
  }
  await av.Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });
  const recording = new av.Audio.Recording();
  const preset = av.Audio.RecordingOptionsPresets?.HIGH_QUALITY;
  await recording.prepareToRecordAsync(preset);
  await recording.startAsync();
  return {
    stopAndGetUri: async () => {
      await recording.stopAndUnloadAsync();
      await av.Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      return recording.getURI();
    },
    cancel: async () => {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      await av.Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    },
  };
}

/** Energetic pacing for on-device speech when available. */
export function speakCoachVoiceSummary(text: string): void {
  const speech = loadSpeech();
  if (!speech) {
    throw new Error("Speech native module unavailable in this app build.");
  }
  speech.stop();
  speech.speak(text, {
    language: "en-US",
    pitch: 1.08,
    rate: 1.05,
  });
}

export function stopCoachVoiceSpeech(): void {
  try {
    loadSpeech()?.stop();
  } catch {
    // ignore
  }
}
