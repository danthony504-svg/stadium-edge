/**
 * Temporary device attestation helpers for diagnosing stale Coach UI.
 * Read-only classification — does not alter OTA auto-apply or Coach logic.
 */

/** Healthy production OTA for runtime 1.1.0 (greenfield Coach). */
export const EXPECTED_HEALTHY_RUNTIME = "1.1.0";
/**
 * Current production channel tip (fail-soft ClerkExpoPasskeys @ main 23550135).
 * Case A no longer requires an exact id match — any non-embedded 1.1.0 tip is healthy.
 */
export const EXPECTED_HEALTHY_UPDATE_ID = "01a136bb-633c-7edf-9d49-9626be829d5f";
export const EXPECTED_HEALTHY_EMBEDDED = false;

export type DeviceAttestationCase = "A" | "B" | "C" | "UNKNOWN";

export type DeviceAttestationInput = {
  runtimeVersion: string;
  updateId: string;
  isEmbeddedLaunch: boolean;
  appVersion?: string;
};

export type DeviceAttestationResult = {
  caseId: DeviceAttestationCase;
  label: string;
  summary: string;
  recoveryPath: string;
  matchesExpectedUpdateId: boolean;
  isLegacyRuntime: boolean;
};

function normalizeId(id: string): string {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^embedded$/i, "");
}

function isBlankUpdateId(id: string): boolean {
  const n = normalizeId(id);
  return !n || n === "—" || n === "-" || n === "null" || n === "undefined";
}

function isLegacyRuntime(runtime: string): boolean {
  const r = String(runtime ?? "").trim();
  return r === "1.0.3" || r === "1.0.0" || r.startsWith("1.0.");
}

/**
 * Case A — runtime 1.1.0 + correct updateId → stale Add-to-slip is another renderer.
 * Case B — runtime 1.1.0 + wrong/missing updateId (or embedded) → OTA apply failing.
 * Case C — runtime 1.0.3 / 1.0.0 → binary cannot receive 1.1.0 OTA.
 */
export function classifyDeviceAttestation(
  input: DeviceAttestationInput,
): DeviceAttestationResult {
  const runtime = String(input.runtimeVersion ?? "").trim();
  const updateId = String(input.updateId ?? "").trim();
  const matchesExpectedUpdateId =
    normalizeId(updateId) === normalizeId(EXPECTED_HEALTHY_UPDATE_ID);
  const legacy = isLegacyRuntime(runtime);

  if (legacy) {
    return {
      caseId: "C",
      label: "Case C — legacy runtime (cannot receive 1.1.0 OTA)",
      summary: `Updates.runtimeVersion=${runtime || "—"}. This native binary is not on the 1.1.0 update stream, so the production 1.1.0 greenfield Coach OTA will never apply.`,
      recoveryPath: caseCRecoveryPath(runtime),
      matchesExpectedUpdateId: false,
      isLegacyRuntime: true,
    };
  }

  // Case A: any non-embedded 1.1.0 tip counts as healthy apply (exact tip id drifts every publish).
  if (
    runtime === EXPECTED_HEALTHY_RUNTIME &&
    !input.isEmbeddedLaunch &&
    !isBlankUpdateId(updateId)
  ) {
    return {
      caseId: "A",
      label: "Case A — healthy OTA identity; tip is running",
      summary: `runtime=${EXPECTED_HEALTHY_RUNTIME}, updateId=${updateId}, isEmbeddedLaunch=false${matchesExpectedUpdateId ? " (matches channel tip constant)" : " (superseding tip — ok)"}.`,
      recoveryPath:
        "OTA apply succeeded. If Coach UI still looks stale, trace the renderer — do not assume a missing OTA.",
      matchesExpectedUpdateId,
      isLegacyRuntime: false,
    };
  }

  if (runtime === EXPECTED_HEALTHY_RUNTIME) {
    return {
      caseId: "B",
      label: "Case B — OTA check/apply failing or embedded winning",
      summary: `Runtime is ${EXPECTED_HEALTHY_RUNTIME} but updateId=${updateId || "—"} (channel tip ${EXPECTED_HEALTHY_UPDATE_ID}); isEmbeddedLaunch=${String(input.isEmbeddedLaunch)}.`,
      recoveryPath: caseBRecoveryPath(),
      matchesExpectedUpdateId: false,
      isLegacyRuntime: false,
    };
  }

  return {
    caseId: "UNKNOWN",
    label: "Unknown runtime — capture attestation before any publish",
    summary: `Unexpected runtimeVersion=${runtime || "—"}, updateId=${updateId || "—"}, appVersion=${input.appVersion ?? "—"}.`,
    recoveryPath:
      "Copy the full OTA Diagnostics report. Do not publish from ota-recovery. Do not create a native build yet. Confirm the device binary and channel before any recovery action.",
    matchesExpectedUpdateId,
    isLegacyRuntime: false,
  };
}

function caseBRecoveryPath(): string {
  return [
    "Report exact checkForUpdateAsync / fetchUpdateAsync / reloadAsync errors from this screen before republishing.",
    "Do not publish from ota-recovery.",
    "Do not create a native build yet.",
    "If check finds an update but fetch/reload fails, fix apply/rollback first.",
    "If check finds nothing and isEmbeddedLaunch=true, embedded bundle is winning — inspect native logs and emergency launch reason.",
  ].join(" ");
}

function caseCRecoveryPath(runtime: string): string {
  return [
    `Confirm this ${runtime || "legacy"} binary cannot receive the 1.1.0 OTA (Expo runtime streams are exact-match).`,
    "Publishing current main JS to runtime 1.0.3/1.0.0 is NOT technically safe: main references native modules unavailable in that binary (notably RNPurchases / react-native-purchases; StoreKit paths hard-crash if required without the native module).",
    "Do not publish full Coach UI to 1.0.3 just to force the new UI.",
    "Do not publish from ota-recovery.",
    "Do not create a native build yet.",
    "Safe options only: (1) install App Store / TestFlight 1.1.0 binary, then apply the 1.1.0 production OTA; or (2) dedicated minimal force-update OTA via scripts/prepare-force-update-ota-103.sh (app.forceUpdate tree only — no Coach UI).",
  ].join(" ");
}

/** Static Case C native-module compatibility note (main vs 1.0.3 binary). */
export function caseCNativeModuleSafetyReport(): string {
  return [
    "Case C native-module compatibility (main → 1.0.3/1.0.0):",
    "- UNSAFE: shipping current main Coach/app JS onto runtime 1.0.3.",
    "- react-native-purchases (NativeModules.RNPurchases) is linked in 1.1.0 binaries; 1.0.3 App Store builds lack it. Requiring the JS package without RNPurchases constructs NativeEventEmitter(undefined) and hard-crashes (historical OTA #460/#461).",
    "- purchases.ts guards exist, but main still pulls StoreKit/subscription/passkey graphs that assume the 1.1.0 native surface.",
    "- @clerk/expo-passkeys and related auth native surface are part of the 1.1.0 tree — not guaranteed on 1.0.3.",
    "- Technically safe for 1.0.3 only: the dedicated force-update bundle (app.forceUpdate / EXPO_PUBLIC_FORCE_UPDATE_ONLY) which never evaluates Coach/StoreKit routes — it does NOT deliver the new Coach UI.",
    "- Conclusion: do not publish main-only OTA targeted at 1.0.3 to fix stale Coach UI. Device must move to a 1.1.0 native binary first.",
  ].join("\n");
}

export function formatAttestationHeadline(result: DeviceAttestationResult): string {
  return `${result.caseId}: ${result.label}`;
}

export function expectedHealthyLines(): string[] {
  return [
    `expected runtimeVersion: ${EXPECTED_HEALTHY_RUNTIME}`,
    `expected updateId: ${EXPECTED_HEALTHY_UPDATE_ID}`,
    `expected isEmbeddedLaunch: ${String(EXPECTED_HEALTHY_EMBEDDED)}`,
  ];
}

/** True when updateId is missing/embedded placeholder (helps Case B copy). */
export function isMissingOrEmbeddedUpdateId(updateId: string): boolean {
  return isBlankUpdateId(updateId) || /^embedded$/i.test(String(updateId).trim());
}
