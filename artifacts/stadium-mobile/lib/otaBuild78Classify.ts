/**
 * Build 78 TestFlight / OTA classification (A–E).
 * Pure helpers — no Coach, sim, or OTA side effects.
 *
 * A = correct current production tip loaded
 * B = old 1.1.0 OTA loaded
 * C = embedded Build 78 bundle loaded
 * D = OTA check/download/apply failing
 * E = runtime mismatch
 */

export const EXPECTED_APP_VERSION = "1.1.0";
export const EXPECTED_BUILD_NUMBER = "78";
export const EXPECTED_RUNTIME_VERSION = "1.1.0";
export const EXPECTED_CHANNEL = "production";
/** Live production iOS tip as of 2026-10-12 publish run 38197651441 @ a20c3939. */
export const EXPECTED_UPDATE_ID = "01a12e0b-2bdc-75dd-944b-310a4eb5add5";
export const EXPECTED_TIP_COMMIT = "a20c39394f35fd563a5b6483274df142aaed5e7d";

export type Build78OtaClass = "A" | "B" | "C" | "D" | "E" | "UNKNOWN";

export type Build78OtaInput = {
  appVersion?: string;
  buildNumber?: string;
  runtimeVersion: string;
  updateId: string;
  isEmbeddedLaunch: boolean;
  channel?: string;
  commitHash?: string;
  checkResult?: string;
  fetchResult?: string;
  reloadResult?: string;
  checkError?: string;
  downloadError?: string;
  isEmergencyLaunch?: boolean;
  /** Behavioral: Add-to-slip / Slip UI visible on Coach. */
  addToSlipVisible?: boolean | null;
};

export type Build78OtaResult = {
  classId: Build78OtaClass;
  label: string;
  summary: string;
  recovery: string;
  matchesExpectedUpdateId: boolean;
  tipMarkersExpectedIfClassA: {
    slipUiEnabled: false;
    greenfieldBuildCoachParlay: true;
    qualityFloorFrom709: false;
  };
};

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

function normId(id: string): string {
  return norm(id).toLowerCase().replace(/^embedded$/i, "");
}

function isBlankUpdateId(id: string): boolean {
  const n = normId(id);
  return !n || n === "—" || n === "-" || n === "null" || n === "undefined";
}

function looksLikeProbeError(text: string | undefined): boolean {
  const t = norm(text).toLowerCase();
  if (!t || t === "—" || t === "-") return false;
  if (t.startsWith("err:")) return true;
  if (t.includes("timed out")) return true;
  if (t.includes("timeout after")) return true;
  if (t.includes("network")) return true;
  if (t.includes("failed")) return true;
  return false;
}

function isLegacyRuntime(runtime: string): boolean {
  const r = norm(runtime);
  if (!r || r === "—") return false;
  if (r === EXPECTED_RUNTIME_VERSION) return false;
  return r === "1.0.3" || r === "1.0.0" || r.startsWith("1.0.");
}

/**
 * Classify Build 78 device OTA identity against the live production tip.
 */
export function classifyBuild78Ota(input: Build78OtaInput): Build78OtaResult {
  const runtime = norm(input.runtimeVersion);
  const updateId = norm(input.updateId);
  const matchesExpectedUpdateId =
    normId(updateId) === normId(EXPECTED_UPDATE_ID);
  const tipMarkersExpectedIfClassA = {
    slipUiEnabled: false as const,
    greenfieldBuildCoachParlay: true as const,
    /** #709 is on main but not yet published to production OTA. */
    qualityFloorFrom709: false as const,
  };

  if (isLegacyRuntime(runtime) || (runtime && runtime !== EXPECTED_RUNTIME_VERSION && runtime !== "—")) {
    if (runtime !== EXPECTED_RUNTIME_VERSION) {
      return {
        classId: "E",
        label: "E — runtime mismatch",
        summary: `Updates.runtimeVersion=${runtime || "—"} (expected ${EXPECTED_RUNTIME_VERSION}). This binary is not on the 1.1.0 update stream.`,
        recovery:
          "Do not publish current main Coach JS onto a legacy runtime. Confirm TestFlight Build 78 / app 1.1.0 is installed. Do not cut a new native build until runtime identity is confirmed. Dedicated 1.0.3 force-update-only OTA (no Coach) is a separate path.",
        matchesExpectedUpdateId: false,
        tipMarkersExpectedIfClassA,
      };
    }
  }

  const applyFailing =
    !!input.isEmergencyLaunch ||
    looksLikeProbeError(input.checkResult) ||
    looksLikeProbeError(input.fetchResult) ||
    looksLikeProbeError(input.reloadResult) ||
    looksLikeProbeError(input.checkError) ||
    looksLikeProbeError(input.downloadError);

  if (runtime === EXPECTED_RUNTIME_VERSION && input.isEmbeddedLaunch && isBlankUpdateId(updateId)) {
    return {
      classId: applyFailing ? "D" : "C",
      label: applyFailing
        ? "D — OTA check/download/apply failing (embedded still winning)"
        : "C — embedded Build 78 bundle loaded",
      summary: `runtime=${runtime}, isEmbeddedLaunch=true, updateId=${updateId || "embedded"}.`,
      recovery: applyFailing
        ? "Capture exact check/fetch/reload errors from OTA Diagnostics. Fix apply/rollback before any republish. Do not publish and do not create a native build yet."
        : "On device: Menu → OTA Diagnostics → Check, fetch & reload. Re-read updateId (expect 01a12e0b…) and isEmbeddedLaunch=false. Do not republish until tip is proven loaded.",
      matchesExpectedUpdateId: false,
      tipMarkersExpectedIfClassA,
    };
  }

  if (runtime === EXPECTED_RUNTIME_VERSION && applyFailing && !matchesExpectedUpdateId) {
    return {
      classId: "D",
      label: "D — OTA check/download/apply failing",
      summary: `runtime=${runtime}, updateId=${updateId || "—"}, isEmbeddedLaunch=${String(input.isEmbeddedLaunch)}; probe/native errors present.`,
      recovery:
        "Report exact checkForUpdateAsync / fetchUpdateAsync / reloadAsync / checkError / downloadError before republishing. Do not publish from ota-recovery. Do not create a native build yet.",
      matchesExpectedUpdateId: false,
      tipMarkersExpectedIfClassA,
    };
  }

  if (runtime === EXPECTED_RUNTIME_VERSION && matchesExpectedUpdateId) {
    if (input.isEmbeddedLaunch) {
      return {
        classId: "D",
        label: "D — OTA check/download/apply failing",
        summary:
          "Expected updateId reported but isEmbeddedLaunch=true — treat as apply/rollback failure until embedded clears.",
        recovery:
          "Inspect emergencyLaunchReason and native expo-updates logs. Force check/fetch/reload once. Do not republish until isEmbeddedLaunch=false with tip updateId.",
        matchesExpectedUpdateId: true,
        tipMarkersExpectedIfClassA,
      };
    }
    const slipNote =
      input.addToSlipVisible === true
        ? " WARNING: Add-to-slip visible despite tip identity — tip ships SLIP_UI_ENABLED=false; investigate stale renderer, not missing OTA."
        : "";
    return {
      classId: "A",
      label: "A — correct current production OTA loaded",
      summary: `runtime=${EXPECTED_RUNTIME_VERSION}, updateId=${EXPECTED_UPDATE_ID}, isEmbeddedLaunch=false, tip commit ${EXPECTED_TIP_COMMIT.slice(0, 8)}. Tip markers: SLIP_UI_ENABLED=false, greenfield buildCoachParlay=yes, #709 quality floor=no (unpublished).${slipNote}`,
      recovery:
        "Do not republish to fix tip identity. For #709 quality-floor only: publish a new production OTA from main after this tip identity is proven. If Add-to-slip still shows with proven tip, trace the slip renderer — do not assume OTA miss.",
      matchesExpectedUpdateId: true,
      tipMarkersExpectedIfClassA,
    };
  }

  if (runtime === EXPECTED_RUNTIME_VERSION) {
    return {
      classId: "B",
      label: "B — old 1.1.0 OTA loaded",
      summary: `runtime=${runtime}, updateId=${updateId || "—"} (expected ${EXPECTED_UPDATE_ID}), isEmbeddedLaunch=${String(input.isEmbeddedLaunch)}.`,
      recovery:
        "On device: Check, fetch & reload toward tip 01a12e0b…. Confirm Add-to-slip disappears (tip has SLIP_UI_ENABLED=false). Do not publish #709 until tip identity is proven on device.",
      matchesExpectedUpdateId: false,
      tipMarkersExpectedIfClassA,
    };
  }

  return {
    classId: "UNKNOWN",
    label: "UNKNOWN — incomplete device report",
    summary: `runtime=${runtime || "—"}, updateId=${updateId || "—"}, isEmbeddedLaunch=${String(input.isEmbeddedLaunch)}.`,
    recovery:
      "Copy the full OTA Diagnostics report from Build 78. Do not publish. Do not create a native build yet.",
    matchesExpectedUpdateId,
    tipMarkersExpectedIfClassA,
  };
}

/** Tip marker expectations for the live production head (not #709). */
export function productionTipMarkerExpectations(): {
  slipUiEnabled: false;
  greenfieldBuildCoachParlay: true;
  qualityFloorFrom709: false;
  updateId: string;
  commit: string;
} {
  return {
    slipUiEnabled: false,
    greenfieldBuildCoachParlay: true,
    qualityFloorFrom709: false,
    updateId: EXPECTED_UPDATE_ID,
    commit: EXPECTED_TIP_COMMIT,
  };
}
