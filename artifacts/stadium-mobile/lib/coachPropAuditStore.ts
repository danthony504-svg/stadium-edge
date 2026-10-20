import AsyncStorage from "@react-native-async-storage/async-storage";
import { latestCoachPropAudit, type PropAuditReport } from "./coachPropAudit.ts";
const KEY = "@stadium/coach-prop-audit-v1";
// Serialization and storage happen only after the deferred, chunked review.
let pendingWrite: Promise<void> = Promise.resolve();
let newestStart = "";
export async function persistCoachPropAudit(report: PropAuditReport): Promise<void> {
  if (report.startedAt < newestStart) return;
  newestStart = report.startedAt;
  pendingWrite = pendingWrite.then(async () => {
    if (report.startedAt < newestStart) return;
    try { await AsyncStorage.setItem(KEY, JSON.stringify(report)); } catch { /* local diagnostics only */ }
  });
  await pendingWrite;
}
export async function readCoachPropAuditReport(): Promise<string> {
  const report = latestCoachPropAudit();
  if (report) return JSON.stringify(report, null, 2);
  return (await AsyncStorage.getItem(KEY)) ?? "No completed prop audit is available. Build a Coach ticket first.";
}
