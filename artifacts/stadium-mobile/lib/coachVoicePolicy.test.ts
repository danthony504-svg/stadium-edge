import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCoachVoiceAvailability,
  shouldEnableCoachVoiceUi,
} from "./coachVoicePolicy.ts";

test("Coach voice UI is hard-disabled on production channel", () => {
  assert.equal(
    shouldEnableCoachVoiceUi({ isDev: false, channel: "production" }),
    false,
  );
  assert.equal(
    shouldEnableCoachVoiceUi({ isDev: false, channel: "prod" }),
    false,
  );
  // __DEV__ alone must not unlock production channel voice.
  assert.equal(
    shouldEnableCoachVoiceUi({ isDev: true, channel: "production" }),
    false,
  );
});

test("Coach voice UI enabled on preview / development / __DEV__", () => {
  assert.equal(
    shouldEnableCoachVoiceUi({ isDev: false, channel: "preview" }),
    true,
  );
  assert.equal(
    shouldEnableCoachVoiceUi({ isDev: false, channel: "development" }),
    true,
  );
  assert.equal(
    shouldEnableCoachVoiceUi({ isDev: true, channel: "preview" }),
    true,
  );
  assert.equal(
    shouldEnableCoachVoiceUi({ isDev: true, channel: null }),
    true,
  );
});

test("resolveCoachVoiceAvailability reports native gap without enabling production", () => {
  const prod = resolveCoachVoiceAvailability({
    isDev: false,
    channel: "production",
    hasRecordingNative: true,
    hasSpeechNative: true,
  });
  assert.equal(prod.uiEnabled, false);
  assert.equal(prod.nativeReady, false);

  const previewGap = resolveCoachVoiceAvailability({
    isDev: false,
    channel: "preview",
    hasRecordingNative: false,
    hasSpeechNative: false,
  });
  assert.equal(previewGap.uiEnabled, true);
  assert.equal(previewGap.nativeReady, false);
  assert.match(previewGap.reason ?? "", /updated preview app/i);

  const ready = resolveCoachVoiceAvailability({
    isDev: false,
    channel: "preview",
    hasRecordingNative: true,
    hasSpeechNative: true,
  });
  assert.equal(ready.uiEnabled, true);
  assert.equal(ready.nativeReady, true);
  assert.equal(ready.reason, null);
});
