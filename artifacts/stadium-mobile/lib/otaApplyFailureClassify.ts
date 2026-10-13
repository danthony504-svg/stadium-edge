/**
 * Distinguish OTA launch failure vs update-selection failure after Restart.
 * Pure — no expo-updates / RN imports (node:test safe).
 */

export type OtaApplyFailureKind =
  | "launch_failed"
  | "selection_failed"
  | "applied_ok"
  | "idle_embedded"
  | "unknown";

export type OtaApplyFailureInput = {
  /** JS ledger reconcile outcome from the last Restart target. */
  reconcileObserved: "no-target" | "launched" | "failed" | null;
  failedTargetId?: string | null;
  failedCount?: number | null;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason?: string | null;
  runningUpdateId: string | null;
  /** Tip the user tapped Restart for (downloaded / pending). */
  lastRestartTargetId?: string | null;
  updatePreviouslyFailedReason?: boolean;
};

export type OtaApplyFailureResult = {
  kind: OtaApplyFailureKind;
  label: string;
  summary: string;
};

/**
 * launch_failed — Restart targeted T but boot did not stay on T (ledger failed /
 * emergency launch / native updatePreviouslyFailed).
 * selection_failed — Restart/download path never selected a tip (embedded, no
 * emergency, no ledger pending target, often isUpdatePending cleared).
 * applied_ok — running matches last Restart target / reconcile launched.
 * idle_embedded — cold start on embedded with no Restart pending (expected until apply).
 */
export function classifyOtaApplyFailure(
  input: OtaApplyFailureInput,
): OtaApplyFailureResult {
  const running = (input.runningUpdateId ?? "").trim() || null;
  const target = (input.lastRestartTargetId ?? "").trim() || null;

  if (input.reconcileObserved === "launched") {
    return {
      kind: "applied_ok",
      label: "Applied OK — Restart target is running",
      summary: `running=${running ?? "—"} matched last Restart target.`,
    };
  }

  if (
    input.reconcileObserved === "failed" ||
    input.isEmergencyLaunch ||
    input.updatePreviouslyFailedReason
  ) {
    const why = input.isEmergencyLaunch
      ? `emergencyLaunch reason=${input.emergencyLaunchReason || "—"}`
      : input.reconcileObserved === "failed"
        ? `ledger failed target=${input.failedTargetId ?? "—"} count=${input.failedCount ?? "—"}`
        : "native reason=updatePreviouslyFailed";
    return {
      kind: "launch_failed",
      label: "Launch failure — tip started then did not stay running",
      summary: `${why}; running=${running ?? "embedded"}.`,
    };
  }

  if (
    target &&
    running &&
    target.toLowerCase() !== running.toLowerCase() &&
    input.isEmbeddedLaunch
  ) {
    return {
      kind: "launch_failed",
      label: "Launch failure — Restart target ≠ running (embedded won)",
      summary: `lastRestartTarget=${target} running=${running} isEmbeddedLaunch=true.`,
    };
  }

  if (input.isEmbeddedLaunch && input.reconcileObserved === "no-target") {
    return {
      kind: "idle_embedded",
      label: "Idle embedded — no Restart target recorded this boot",
      summary:
        "isEmbeddedLaunch=true with empty JS ledger pendingTarget. Cold start with fallbackToCacheTimeout=0 is expected; after an App-update-ready Restart this indicates selection never armed a target (selection_failed) or ledger write was lost.",
    };
  }

  if (input.isEmbeddedLaunch && !target) {
    return {
      kind: "selection_failed",
      label: "Selection failure — embedded with no successful tip selection",
      summary:
        "Device remains on embedded bundle without a recorded Restart target or emergency flag. Download/banner can still find the channel tip, but native selection is not launching it.",
    };
  }

  if (!input.isEmbeddedLaunch && running) {
    return {
      kind: "applied_ok",
      label: "Running a downloaded OTA",
      summary: `isEmbeddedLaunch=false updateId=${running}.`,
    };
  }

  return {
    kind: "unknown",
    label: "Unknown — capture /ota-debug static report",
    summary: `embedded=${input.isEmbeddedLaunch} running=${running ?? "—"} reconcile=${input.reconcileObserved ?? "—"}`,
  };
}
