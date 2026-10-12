/**
 * Pure diagnosis of why a device may stay on the embedded bundle.
 * No expo-updates / RN imports — safe for node:test.
 */

import { OTA_DEBUG_UNAVAILABLE } from "./otaDebugGuards.ts";
import {
  failedLaunchCount,
  type OtaFailedLaunchRecord,
} from "./otaFailedLaunch.ts";

export type EmbeddedApplyDiagnosisInput = {
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason?: string;
  isUpdatePending: boolean;
  isStartupProcedureRunning: boolean;
  runningUpdateId: string;
  downloadedUpdateIdFromContext: string;
  availableUpdateIdFromContext: string;
  fallbackToCacheTimeout: number;
  failedLaunchRecord: OtaFailedLaunchRecord;
  recoveryPending?: boolean;
  recoveryReloadTargetId?: string;
};

/** Explain why embedded may still be the running bundle (read-only). */
export function diagnoseEmbeddedApplyState(input: EmbeddedApplyDiagnosisInput): string {
  const lines: string[] = [];
  const downloaded =
    input.downloadedUpdateIdFromContext &&
    input.downloadedUpdateIdFromContext !== OTA_DEBUG_UNAVAILABLE &&
    input.downloadedUpdateIdFromContext !== "—"
      ? input.downloadedUpdateIdFromContext
      : null;
  const available =
    input.availableUpdateIdFromContext &&
    input.availableUpdateIdFromContext !== OTA_DEBUG_UNAVAILABLE &&
    input.availableUpdateIdFromContext !== "—"
      ? input.availableUpdateIdFromContext
      : null;
  const candidate = downloaded ?? available;
  const failCount = candidate ? failedLaunchCount(input.failedLaunchRecord, candidate) : 0;

  if (input.isEmbeddedLaunch) {
    lines.push(
      "RUNNING EMBEDDED: Updates.isEmbeddedLaunch=true — this boot selected the binary-embedded update, not a post-download OTA launch.",
    );
  } else {
    lines.push("Running a downloaded OTA (isEmbeddedLaunch=false).");
  }

  if (input.isEmergencyLaunch) {
    lines.push(
      `EXPO EMERGENCY LAUNCH: true — native error recovery rolled back. reason=${input.emergencyLaunchReason || "—"}`,
    );
  } else if (input.isEmbeddedLaunch) {
    lines.push(
      "isEmergencyLaunch=false — this boot is not flagged as emergency recovery; either the OTA was never successfully selected for launch, or selection skipped a previously-failed update without emergency mode.",
    );
  }

  if (input.isStartupProcedureRunning) {
    lines.push(
      "isStartupProcedureRunning=true — native updates startup procedure has not completed (or is stuck). UI can paint while this remains true when fallbackToCacheTimeout=0.",
    );
  }

  lines.push(
    `fallbackToCacheTimeout=${input.fallbackToCacheTimeout}: cold start does not wait for network; launches currently-selected (usually embedded) immediately, then ON_LOAD/JS prefetch may download in background.`,
  );

  if (candidate) {
    lines.push(`Downloaded/available candidate id (context): ${candidate}`);
    if (failCount > 0) {
      lines.push(
        `JS failed-launch ledger count for candidate=${failCount} (auto-reload blocked at ≥2).`,
      );
    }
    if (
      input.failedLaunchRecord.pendingTargetId &&
      input.failedLaunchRecord.pendingTargetId !== input.runningUpdateId
    ) {
      lines.push(
        `JS ledger pendingTargetId=${input.failedLaunchRecord.pendingTargetId} ≠ running ${input.runningUpdateId} — last Restart likely failed to stay on that OTA (Expo rolled back or never launched it).`,
      );
    }
  } else {
    lines.push(
      "No downloadedManifest.id / latestManifest.id in latestContext — native has no staged OTA visible to JS right now.",
    );
  }

  if (input.isUpdatePending) {
    lines.push("isUpdatePending=true — a newer update is staged; Restart/reload should select it.");
  } else if (input.isEmbeddedLaunch) {
    lines.push(
      "isUpdatePending=false while embedded — either nothing is staged, identity gate cleared same-id pending, or native selection already abandoned the candidate.",
    );
  }

  if (input.recoveryPending) {
    lines.push(
      `JS recovery.pending=true reloadTarget=${input.recoveryReloadTargetId ?? "—"}`,
    );
  }

  lines.push(
    "Banner can reappear while stuck on embedded: check/fetch finds production tip → download → Restart → if OTA throws before Expo marks launch successful, selection returns to embedded.",
  );
  return lines.join(" ");
}
