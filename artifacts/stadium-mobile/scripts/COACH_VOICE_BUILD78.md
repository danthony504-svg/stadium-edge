# Coach Voice — Build 78 / IPA compatibility

**Verdict: not OTA-compatible with the existing App Store / preview IPA (Build 78).**  
Do **not** publish a preview OTA claiming full tap-to-talk + spoken summaries until a new native binary ships.

## Gaps in the current binary

| Requirement | Build 78 / current IPA |
|-------------|------------------------|
| `expo-av` (recording + optional audio playback) | **Absent** from the binary |
| `expo-speech` (on-device TTS) | **Absent** from the binary |
| `NSMicrophoneUsageDescription` | **Absent** from Info.plist |
| Server `POST /api/voice/stt` + `/voice/tts` | **Not deployed yet** (code in repo only) |

JS OTA cannot add native modules or Info.plist keys. Fail-soft client code shows the mic on preview with: *“Voice needs an updated preview app with microphone + speech support.”*

## Required before device voice works

1. **Native build (preview IPA)**  
   - Install `expo-av` + `expo-speech` (already listed in `package.json` / `app.json` plugins).  
   - Rebuild iOS with `NSMicrophoneUsageDescription` present.  
   - Distribute that IPA to TestFlight / preview devices.

2. **Server deploy**  
   - Ship `artifacts/api-server/src/routes/voice.ts` (`/api/voice/stt`, `/api/voice/tts`).  
   - Reuses existing `OPENAI_API_KEY` (Whisper STT + optional `gpt-4o-mini-tts`).  
   - No client-side provider credentials.

3. **Then** preview OTA (JS) on top of the new IPA — not on Build 78.

## Production

- Channel gate hard-disables voice UI (`shouldEnableCoachVoiceUi`).  
- Production OTA freeze remains armed (`.ota-production-freeze`).  
- **No production OTA** for this feature.

## Local verification (this change)

```bash
cd artifacts/stadium-mobile && pnpm test -- lib/coachVoicePolicy.test.ts lib/coachVoiceSummary.test.ts lib/coachVoiceNative.test.ts
cd artifacts/api-server && pnpm test -- test/voiceRoutes.test.ts
```
