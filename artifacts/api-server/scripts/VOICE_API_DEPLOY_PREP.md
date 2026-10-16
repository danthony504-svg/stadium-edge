# Voice API deployment prep (Render — shared preview + production)

**Status: PREPARED ONLY — do not deploy until explicitly authorized.**

Render serves one API for both preview and production app clients. Shipping
`/api/voice/*` makes the endpoints reachable from any client that can auth;
production Coach UI remains channel-gated off (`shouldEnableCoachVoiceUi`).

## Exact server diff (vs `main`)

Only these api-server paths change for voice:

| Path | Change |
|------|--------|
| `artifacts/api-server/src/routes/voice.ts` | **New** — STT + TTS routes |
| `artifacts/api-server/src/routes/index.ts` | Mount `voiceRouter` after `chatRouter` |
| `artifacts/api-server/test/voiceRoutes.test.ts` | Auth-gate tests (not required at runtime) |

Source commit: `218188f6`  
Generate patch:

```bash
git diff origin/main...HEAD -- \
  artifacts/api-server/src/routes/voice.ts \
  artifacts/api-server/src/routes/index.ts
```

**Unrelated api-server changes in this deploy set: none** (voice files only).

## Authentication

| Endpoint | Auth |
|----------|------|
| `POST /api/voice/stt` | Clerk `getAuth(req).userId` required → **401** `auth required` |
| `POST /api/voice/tts` | Same |

- No OpenAI / Whisper keys on the client; server uses `resolveOpenAIConfig()` → `OPENAI_API_KEY` (already on Render for chat).
- Unauthenticated probes fail closed (verified by `test/voiceRoutes.test.ts`).

## Request limits

| Control | Value |
|---------|-------|
| STT rate limit | 30 / 60s (`voice-stt`) |
| TTS rate limit | 30 / 60s (`voice-tts`) |
| Max STT `audioBase64` chars | 4_000_000 (~3MB decoded) → **413** |
| Max TTS text | 800 chars (clipped) |
| Global JSON body | existing Express `5mb` |

## Production safety when API is live

- Production **app channel** keeps voice UI disabled (client gate).
- Endpoints still require a signed-in Clerk user if someone calls them directly.
- No production OTA / App Store / native production build in this prep.

## Deploy checklist (when authorized later)

1. Confirm freeze still armed if avoiding production OTA coupling.
2. Deploy api-server commit that includes `voice.ts` + `index.ts` mount only.
3. Smoke: signed-out `POST /api/voice/stt` → 401; signed-in with tiny payload → 400/502 (not 404).
4. Preview IPA with mic modules can then use STT.
