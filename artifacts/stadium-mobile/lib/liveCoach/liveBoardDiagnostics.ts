/**
 * Read-only Live Board diagnostics (Phase 1).
 * Proves state sync — must NEVER be presented as Coach recommendations.
 */

import type { LiveBoardDiagnosticRow, NormalizedLiveMarket } from "./types.ts";

/** One diagnostic row per normalized live market. */
export function buildLiveBoardDiagnosticRows(
  markets: readonly NormalizedLiveMarket[],
): LiveBoardDiagnosticRow[] {
  return markets.map((m) => ({
    eventId: m.eventId,
    matchup: m.matchup,
    score: formatScore(m.awayScore, m.homeScore),
    period: formatPeriod(m.period, m.periodLabel),
    clock: m.clock ?? "—",
    priceSource: m.source ?? "—",
    market: m.market,
    line: m.line == null ? "—" : String(m.line),
    price: formatAmerican(m.price),
    providerTimestamp: m.providerLastUpdate ?? "—",
    fetchedAt: m.fetchedAt ?? "—",
    ageStatus: formatAgeStatus(m),
  }));
}

/** Plain-text diagnostic table for logs / debug panels (not user ticket copy). */
export function formatLiveBoardDiagnosticsTable(
  markets: readonly NormalizedLiveMarket[],
): string {
  const rows = buildLiveBoardDiagnosticRows(markets);
  const header =
    "eventId | matchup | score | period | clock | price source | market | line | price | provider timestamp | fetchedAt | age/status";
  const lines = rows.map(
    (r) =>
      `${r.eventId} | ${r.matchup} | ${r.score} | ${r.period} | ${r.clock} | ${r.priceSource} | ${r.market} | ${r.line} | ${r.price} | ${r.providerTimestamp} | ${r.fetchedAt} | ${r.ageStatus}`,
  );
  return [header, ...lines].join("\n");
}

function formatScore(away: number | null, home: number | null): string {
  if (away == null && home == null) return "—";
  return `${away ?? "—"}-${home ?? "—"}`;
}

function formatPeriod(period: number | null, label: string | null): string {
  if (label) return label;
  if (period != null) return String(period);
  return "—";
}

function formatAmerican(odds: number): string {
  if (!Number.isFinite(odds)) return "—";
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatAgeStatus(m: NormalizedLiveMarket): string {
  const age =
    m.ageMs == null ? "age=?" : `age=${Math.round(m.ageMs / 1000)}s`;
  const flags = [
    m.freshness,
    m.marketStatus !== "open" ? m.marketStatus : null,
    m.gameStateAdvanced ? "advanced" : null,
    m.unsafe ? "unsafe" : "safe",
  ].filter(Boolean);
  return `${age}/${flags.join(",")}`;
}
