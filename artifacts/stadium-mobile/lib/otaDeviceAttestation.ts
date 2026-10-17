/**
 * Temporary device attestation helpers for diagnosing stale Coach UI.
 * Read-only classification — does not alter OTA auto-apply or Coach logic.
 */

/** Healthy OTA stream for App Store / TestFlight Build 78+ (greenfield Coach). */
export const EXPECTED_HEALTHY_RUNTIME = "1.1.0";
export const EXPECTED_HEALTHY_EMBEDDED = false;

export type DeviceAttestationCase = "A" | "B" | "C" | "UNKNOWN";

/** Tip match: true / false when channel tip id is known; null when not probed. */
export type ChannelTipMatch = boolean | null;

export type DeviceAttestationInput = {
  runtimeVersion: string;
  updateId: string;
  isEmbeddedLaunch: boolean;
  appVersion?: string;
  /** Expo Updates channel (preview / production / …). */
  channel?: string | null;
  /**
   * Current channel tip update id when known (latestContext / check result).
   * Not a hardcoded historical constant — omit when unknown.
   */
  channelTipUpdateId?: string | null;
};

export type DeviceAttestationResult = {
  caseId: DeviceAttestationCase;
  label: string;
  summary: string;
  recoveryPath: string;
  /** @deprecated Use matchesChannelTip — retained for older call sites. */
  matchesExpectedUpdateId: boolean;
  /** true/false when tip known; null when tip unknown. */
  matchesChannelTip: ChannelTipMatch;
  channelStreamLabel: string;
  isLegacyRuntime: boolean;
};

function normalizeId(id: string): string {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^embedded$/i, "");
}

function isBlankUpdateId(id: string | null | undefined): boolean {
  const n = normalizeId(String(id ?? ""));
  return !n || n === "—" || n === "-" || n === "null" || n === "undefined";
}

function isLegacyRuntime(runtime: string): boolean {
  const r = String(runtime ?? "").trim();
  return r === "1.0.3" || r === "1.0.0" || r.startsWith("1.0.");
}

export function normalizeOtaChannelName(
  channel: string | null | undefined,
): string {
  return String(channel ?? "")
    .toLowerCase()
    .trim();
}

/** Screenshot-safe channel stream label (PREVIEW / PRODUCTION / …). */
export function formatOtaChannelStreamLabel(
  channel: string | null | undefined,
): string {
  const ch = normalizeOtaChannelName(channel);
  if (ch === "preview") return "PREVIEW";
  if (ch === "production") return "PRODUCTION";
  if (ch === "development") return "DEVELOPMENT";
  if (!ch) return "UNKNOWN";
  return ch.toUpperCase();
}

/** Compare running updateId to a known channel tip id. */
export function resolveChannelTipMatch(opts: {
  runningUpdateId: string;
  channelTipUpdateId?: string | null;
}): ChannelTipMatch {
  if (isBlankUpdateId(opts.channelTipUpdateId)) return null;
  if (isBlankUpdateId(opts.runningUpdateId)) return false;
  return (
    normalizeId(opts.runningUpdateId) ===
    normalizeId(String(opts.channelTipUpdateId))
  );
}

/**
 * Best-known channel tip update id from Expo context / live check.
 * Never falls back to a hardcoded historical id.
 */
export function resolveKnownChannelTipUpdateId(opts: {
  availableUpdateIdFromContext?: string | null;
  availableUpdateIdFromCheck?: string | null;
  runningUpdateId?: string | null;
  /** When false and non-embedded, running update is the tip. */
  updateAvailable?: boolean | null;
  isEmbeddedLaunch?: boolean;
}): string | null {
  const fromCheck = String(opts.availableUpdateIdFromCheck ?? "").trim();
  if (!isBlankUpdateId(fromCheck)) return fromCheck;
  const fromCtx = String(opts.availableUpdateIdFromContext ?? "").trim();
  if (!isBlankUpdateId(fromCtx)) return fromCtx;
  if (
    opts.updateAvailable === false &&
    !opts.isEmbeddedLaunch &&
    !isBlankUpdateId(opts.runningUpdateId)
  ) {
    return String(opts.runningUpdateId).trim();
  }
  return null;
}

export function formatChannelTipMatchLabel(match: ChannelTipMatch): string {
  if (match === true) return "yes — running update is current channel tip";
  if (match === false) return "no — running update differs from known channel tip";
  return "unknown — channel tip not probed yet";
}

/**
 * Case A — runtime 1.1.0 + non-embedded OTA + (when tip known) equals channel tip.
 * Case B — runtime 1.1.0 but embedded, blank id, or behind known tip.
 * Case C — runtime 1.0.3 / 1.0.0 → binary cannot receive 1.1.0 OTA.
 */
export function classifyDeviceAttestation(
  input: DeviceAttestationInput,
): DeviceAttestationResult {
  const runtime = String(input.runtimeVersion ?? "").trim();
  const updateId = String(input.updateId ?? "").trim();
  const channelStreamLabel = formatOtaChannelStreamLabel(input.channel);
  const matchesChannelTip = resolveChannelTipMatch({
    runningUpdateId: updateId,
    channelTipUpdateId: input.channelTipUpdateId,
  });
  const legacy = isLegacyRuntime(runtime);

  if (legacy) {
    return {
      caseId: "C",
      label: "Case C — legacy runtime (cannot receive 1.1.0 OTA)",
      summary: `channel=${channelStreamLabel}, Updates.runtimeVersion=${runtime || "—"}. This native binary is not on the 1.1.0 update stream, so the 1.1.0 Coach OTA will never apply.`,
      recoveryPath: caseCRecoveryPath(runtime),
      matchesExpectedUpdateId: false,
      matchesChannelTip,
      channelStreamLabel,
      isLegacyRuntime: true,
    };
  }

  if (runtime === EXPECTED_HEALTHY_RUNTIME) {
    // Tip known and running ≠ tip → not healthy Case A (behind / failed apply).
    if (
      matchesChannelTip === false &&
      !input.isEmbeddedLaunch &&
      !isBlankUpdateId(updateId)
    ) {
      return {
        caseId: "B",
        label: "Case B — running update is not the known channel tip",
        summary: `channel=${channelStreamLabel}, runtime=${EXPECTED_HEALTHY_RUNTIME}, updateId=${updateId}, channelTip=${String(input.channelTipUpdateId).trim()}, isEmbeddedLaunch=false.`,
        recoveryPath: caseBRecoveryPath(),
        matchesExpectedUpdateId: false,
        matchesChannelTip,
        channelStreamLabel,
        isLegacyRuntime: false,
      };
    }

    if (!input.isEmbeddedLaunch && !isBlankUpdateId(updateId)) {
      const tipNote =
        matchesChannelTip === true
          ? "matches current channel tip"
          : "channel tip not probed (non-embedded OTA identity OK)";
      return {
        caseId: "A",
        label: "Case A — healthy OTA identity; tip is running",
        summary: `channel=${channelStreamLabel}, runtime=${EXPECTED_HEALTHY_RUNTIME}, updateId=${updateId}, isEmbeddedLaunch=false, ${tipNote}.`,
        recoveryPath:
          "OTA apply succeeded. If Coach UI still looks stale, trace the renderer — do not assume a missing OTA.",
        matchesExpectedUpdateId: matchesChannelTip === true,
        matchesChannelTip,
        channelStreamLabel,
        isLegacyRuntime: false,
      };
    }

    return {
      caseId: "B",
      label: "Case B — OTA check/apply failing or embedded winning",
      summary: `channel=${channelStreamLabel}, runtime=${EXPECTED_HEALTHY_RUNTIME}, updateId=${updateId || "—"}, isEmbeddedLaunch=${String(input.isEmbeddedLaunch)}, tipMatch=${formatChannelTipMatchLabel(matchesChannelTip)}.`,
      recoveryPath: caseBRecoveryPath(),
      matchesExpectedUpdateId: false,
      matchesChannelTip,
      channelStreamLabel,
      isLegacyRuntime: false,
    };
  }

  return {
    caseId: "UNKNOWN",
    label: "Unknown runtime — capture attestation before any publish",
    summary: `channel=${channelStreamLabel}, unexpected runtimeVersion=${runtime || "—"}, updateId=${updateId || "—"}, appVersion=${input.appVersion ?? "—"}.`,
    recoveryPath:
      "Copy the full OTA Diagnostics report. Do not publish from ota-recovery. Do not create a native build yet. Confirm the device binary and channel before any recovery action.",
    matchesExpectedUpdateId: false,
    matchesChannelTip,
    channelStreamLabel,
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

/** Healthy criteria for copy/report — no hardcoded historical updateId. */
export function expectedHealthyLines(opts?: {
  channelTipUpdateId?: string | null;
  channel?: string | null;
}): string[] {
  const stream = formatOtaChannelStreamLabel(opts?.channel);
  const tip = String(opts?.channelTipUpdateId ?? "").trim();
  return [
    `healthy criteria: runtimeVersion=${EXPECTED_HEALTHY_RUNTIME}, isEmbeddedLaunch=${String(EXPECTED_HEALTHY_EMBEDDED)}, non-blank updateId, equals current ${stream} channel tip when tip is known`,
    tip && !isBlankUpdateId(tip)
      ? `known channel tip updateId: ${tip}`
      : "known channel tip updateId: (not probed)",
  ];
}

/** True when updateId is missing/embedded placeholder (helps Case B copy). */
export function isMissingOrEmbeddedUpdateId(updateId: string): boolean {
  return isBlankUpdateId(updateId) || /^embedded$/i.test(String(updateId).trim());
}
