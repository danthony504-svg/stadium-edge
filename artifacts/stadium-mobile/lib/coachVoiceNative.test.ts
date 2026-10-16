import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCoachVoiceRecordingNative,
  hasCoachVoiceSpeechNative,
  resetCoachVoiceNativeForTests,
  setCoachVoiceNativeForTests,
  speakCoachVoiceSummary,
  stopCoachVoiceSpeech,
} from "./coachVoiceNative.ts";

test("fail-soft: missing natives report false without throwing", () => {
  resetCoachVoiceNativeForTests();
  setCoachVoiceNativeForTests({ speech: null, av: null });
  assert.equal(hasCoachVoiceRecordingNative(), false);
  assert.equal(hasCoachVoiceSpeechNative(), false);
  assert.doesNotThrow(() => stopCoachVoiceSpeech());
});

test("speakCoachVoiceSummary uses injected speech module", () => {
  resetCoachVoiceNativeForTests();
  const calls: string[] = [];
  setCoachVoiceNativeForTests({
    speech: {
      speak: (text: string) => {
        calls.push(text);
      },
      stop: () => {},
    },
    av: null,
  });
  speakCoachVoiceSummary("Let's go");
  assert.deepEqual(calls, ["Let's go"]);
  resetCoachVoiceNativeForTests();
});
