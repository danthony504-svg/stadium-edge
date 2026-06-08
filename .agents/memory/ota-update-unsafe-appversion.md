---
name: OTA (eas update) — runtimeVersion strategy (manual string), fingerprint was infeasible
description: Why OTA crashed under appVersion policy, why fingerprint policy can't build on EAS here, and the manual-string workflow that ships OTA safely
---

# CURRENT STATE: runtimeVersion is a MANUAL explicit string ("1.0.0")

app.json `expo.runtimeVersion` is a plain string (`"1.0.0"`), NOT a policy
object. This builds deterministically on EAS and is the version that OTA updates
target.

**Why not `fingerprint` policy (tried, FAILED to build):**
Build #33 errored in the "Configure expo-updates" phase with a runtime-version
mismatch — the fingerprint computed locally by eas-cli != the one computed on the
EAS build server. The build log's fingerprint diff showed TWO causes, both
intrinsic to this Replit + pnpm-monorepo + `EAS_NO_VCS=1` setup:
- `op:"added"` `ios` dir tagged `bareNativeDir`: with `EAS_NO_VCS=1`, git is off
  on the EAS side so `@expo/fingerprint` can't read `.gitignore` (which ignores
  `ios/`), so it counts the PREBUILT `ios/` dir; locally that dir doesn't exist.
- `op:"changed"` `rncoreAutolinkingConfig:ios`: identical packages/versions but
  DIFFERENT ORDER (local sorts `@react-native-async-storage` before `expo`; EAS
  lists `expo` first). pnpm's isolated `.pnpm/...` layout + eas-cli/@expo
  tooling-version nondeterminism.
Fixing both would need a `.fingerprintignore` AND resolving autolinking-order
nondeterminism (likely root `.npmrc` `node-linker=hoisted`, which reshuffles
node_modules for ALL artifacts — api-server/web too) and would still risk
recurring on every dep change. Not worth it. Manual string is reliable.

**Why manual string is still SAFE for OTA (the agent carries the discipline):**
The original crash (below) came from runtimeVersion NOT changing across a native
delta. With a manual string the safety rule is mechanical and falls on the AGENT,
who already classifies every mobile change as JS-only vs native:
- JS-only change (TS/TSX/lib logic, assets) -> keep runtimeVersion -> ship via
  `eas update --branch production`. Safe: same native layer.
- NATIVE change (new/updated native dep, app.json native config, Expo SDK bump,
  plugin add) -> BUMP runtimeVersion (e.g. "1.0.0" -> "1.0.1") AND cut a fresh
  native build (`eas build --platform ios --profile production` + `eas submit`).
  Never OTA a native delta onto an old binary.
Optional belt-and-braces before an OTA: `eas fingerprint:compare` locally to
detect native drift (local-vs-local comparison is deterministic; only
local-vs-EAS mismatched).

Note: build #32 (old appVersion policy) also resolved runtimeVersion to "1.0.0",
so a "1.0.0" OTA can also reach #32 — fine, its native layer matches (all deltas
since were JS-only).

# Other OTA rules that always hold
- `eas update` does NOT inherit eas.json build-profile env — run the export with
  the production `EXPO_PUBLIC_*` values (EXPO_PUBLIC_DOMAIN = published host,
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) or API_BASE falls back to "/api" and Clerk
  key is empty. Ship via `eas update --branch production`.
- Roll back a bad OTA: `eas update:roll-back-to-embedded --branch production
  --runtime-version 1.0.0 --platform ios` (fast — no bundling; bad-bundle
  bundling is what blows the 120s tool limit).

---

# (Historical) the original appVersion-policy OTA crash
`eas update --branch production` from HEAD CRASHED the installed iOS app on launch
(React error boundary "Something went wrong / Please reload"). Root cause: the
`appVersion` policy pinned runtimeVersion at the static app version "1.0.0", which
does NOT change when native deps/modules change, so EAS served an OTA JS bundle to
a native binary it wasn't compatible with — compounded because the installed
build lagged HEAD by many commits of feature work. The manual-string workflow
above prevents this by bumping the string on every native delta.
