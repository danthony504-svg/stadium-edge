# Build 78 vs `preview-build78` — binary difference & pre-freeze-lift validation path

**Authority of this check:** documentation + path identification only.  
**Not authorized by this document:** new EAS/native build, production OTA publish, freeze lift, merge.

Release JS under discussion: `c859c1ce73ae64182a996a2751b4f831d601ba8d`  
Already on controlled channel: preview update `01a142e1-23e0-772e-beb5-bf03df51e982` (group `af92adaa-9a40-44ab-b13a-dfd6d8315061`).

---

## Binary difference (do not conflate)

| Dimension | **App Store / TestFlight Build 78** | **Installed `preview-build78` IPA** | **Plain `preview` / `preview-ota` IPA** |
|-----------|--------------------------------------|--------------------------------------|----------------------------------------|
| Role | Public production binary that crashed in ErrorRecovery | Controlled stand-in for missing-passkeys crash class | Internal preview — **not** a Build 78 stand-in |
| Distribution | App Store / TestFlight | Internal / Ad Hoc (`distribution: internal`) | Internal |
| Baked Expo channel | **`production`** | **`preview`** | **`preview`** |
| Fetches which OTAs? | Production channel only | Preview channel only | Preview channel only |
| `runtimeVersion` | `1.1.0` | `1.1.0` (EAS `9155c37b`) | `1.1.0` (typical) |
| Native `ClerkExpoPasskeys` | **Absent** (crash class: missing module) | **Absent** (stripped via `EXPO_NO_CLERK_PASSKEYS=1` + strip hook) | **Present** (linked) — crash path **UNVERIFIED** |
| Associated Domains / webcredentials | Production entitlements as shipped | **Omitted** when strip flag set (Ad Hoc without that capability) | Usually present (Clerk host) |
| Known install | Device that filed IPS `90811de5-…` | Commit `057c9f0d…` / EAS `9155c37b-0297-45a7-98fe-ea3f38bea6a9` | Various preview builds |
| Can load tip `c859c1ce` **while freeze armed**? | **No** — would require production OTA | **Yes** — already published preview OTA `01a142e1…` | Yes for JS, but **does not** exercise missing-passkeys fail-soft |

### What “compatible” does and does not mean

| Claim | Valid? |
|-------|--------|
| Same `runtimeVersion` (1.1.0) → OTA **eligible** for that runtime family | Yes — compatibility check |
| Unchanged JS-native contract vs baseline `100b2450` for tip `c859c1ce` | Yes — compatibility check |
| Therefore Build 78 cold-launches crash-free on `c859c1ce` | **No** — not established |
| `preview-build78` ≡ App Store Build 78 | **No** — channel, signing, entitlements, embedded bundle, and store provenance differ |

`preview-build78` is the authorized **Build 78–equivalent crash-path binary** for the missing-`ClerkExpoPasskeys` class only. It is not a substitute identity for the App Store binary.

---

## Why App Store Build 78 cannot validate `c859c1ce` before freeze lift

1. Build 78 bakes `expo-channel-name: production`.
2. `.ota-production-freeze` blocks production publish / force / heal / republish (script + workflow enforced).
3. Therefore **no** path exists to deliver `c859c1ce` to App Store Build 78 without lifting the freeze and publishing production — which **this check does not authorize**.

Any pre-lift device attestation of release JS must use a **preview-channel** binary.

---

## Valid Build 78 validation path **before** lifting the production freeze

Constraints honored: **no new native/EAS build**, **no production publication**, freeze stays armed.

### Path A — preferred (existing binary + existing preview OTA)

Use the **already installed** `preview-build78` IPA; do **not** rebuild.

| Step | Action | Pass criteria |
|------|--------|----------------|
| A0 | Confirm IPA is EAS `9155c37b` / commit `057c9f0d…`, runtime `1.1.0`, channel `preview`, `ClerkExpoPasskeys` absent (prior IPA inspect) | Binary identity matches table above |
| A1 | Open app so it fetches preview channel tip | Active update is `01a142e1…` / message contains `c859c1ce` (Menu → Device attestation / Updates metadata if reachable) |
| A2 | Force-quit → **cold launch ×3** | No ErrorRecovery loop, no SIGABRT, UI reaches Home |
| A3 | Home → **Hot Picks** | Coach silent launch + auto-send works |
| A4 | Home → **Easy Money** | Coach silent launch + auto-send works |
| A5 | Record results | New or updated `docs/coach/device-check-ota-01a142e1-*.md` with PASS/FAIL |

**Outcome if A2–A4 PASS:** pre-lift attestation that release JS `c859c1ce` runs on **Build 78–equivalent natives** (missing passkeys) without touching production.  
**Still required before freeze lift (checklist):** Build 78 fatal log / root cause per `.ota-production-freeze`; `.ota-testflight-verified` only after real TF work; owner removes freeze on `main`.  
**Still UNVERIFIED until a later authorized production OTA:** App Store Build 78 executing `c859c1ce`.

### Path B — not valid under this check

| Path | Why disallowed here |
|------|---------------------|
| New `eas build --profile preview-build78` | **New build not authorized** by this check |
| New plain `preview` IPA (with passkeys) as Build 78 stand-in | Wrong native surface — crash class UNVERIFIED |
| Production OTA of `c859c1ce` onto App Store Build 78 | **Production publication not authorized**; freeze armed |
| Treating runtime match alone as Build 78 cold-launch PASS | Compatibility ≠ crash-free launch |

### Path C — App Store Build 78 (only **after** freeze lift — out of scope for this check)

Documented for clarity; **not authorized now**:

1. Lift freeze per script + checklist gates.
2. Publish `c859c1ce` to production (separate owner approval).
3. On App Store Build 78: cold launch ×3, Hot Picks, Easy Money, no ErrorRecovery.
4. Keep embedded rollback available.

---

## Freeze posture (unchanged by this check)

| Item | State |
|------|--------|
| `.ota-production-freeze` | **Armed** |
| Production channel | Embedded rollback `4a0960e4…` (unchanged by preview publish) |
| Preview tip for release JS | `01a142e1…` @ `c859c1ce` |
| New EAS build | **Not authorized** |
| Production publish | **Not authorized** |

---

## Summary

- **Binary difference is material:** channel (`production` vs `preview`), distribution, entitlements, and store identity differ; passkeys absence is the shared crash-class property with `preview-build78`.
- **Valid pre-lift Build 78 path:** existing `preview-build78` `9155c37b` + existing preview OTA `01a142e1` (`c859c1ce`) → cold launches + Hot Picks + Easy Money + no ErrorRecovery — **no new build, no production publish**.
- **App Store Build 78 + `c859c1ce`** remains **UNVERIFIED** until an owner-authorized post-lift production OTA.
