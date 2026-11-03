import type { CandidateReport } from "./coachCandidateTracking.ts";
import { shouldSendCrashReports } from "./crashReportingGate.ts";
/** Deferred, bounded diagnostics only. No simulations, provider calls or alerts. */
export function reportCoachCandidates(report: CandidateReport): void {
  if (!shouldSendCrashReports()) return;
  setTimeout(() => { void send(report); }, 0);
}
async function send(report: CandidateReport) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return;
  const totalChunks = Math.max(1, Math.ceil(report.rows.length / 25));
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(`https://${domain}/api/reliability/coach-candidates`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ ...report, rows: report.rows.slice(chunkIndex * 25, (chunkIndex + 1) * 25), chunkIndex, totalChunks }),
      });
      if (!response.ok) return; // No retry storm; partial chunks stay explicit.
    } catch { return; } finally { clearTimeout(timer); }
  }
}
