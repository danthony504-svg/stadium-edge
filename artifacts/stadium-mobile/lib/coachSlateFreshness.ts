// Coach build freshness — cache accelerates preview only; final picks use live data.

import type { BuiltChatContext } from "./api.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { SlatePreAnalysisSeed } from "./slatePreAnalysis.ts";

/** All sports the Coach surfaces — kept local to avoid expo-ui imports in unit tests. */
const LIVE_SCAN_SPORT_IDS = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "nfl",
  "ncaaf",
  "ncaab",
] as const;

export const COACH_SLATE_PREVIEW_NOTE =
  "Preview from the last board scan — refreshing live odds, injuries, and line movement now.";

/** Digest injury reports so lineups moving to OUT reshuffle rankings. */
export function computeInjuryDigest(
  injuries?: Record<string, GameInjuryReport> | null,
): string {
  if (!injuries) return "";
  return Object.entries(injuries)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 32)
    .map(([game, report]) => {
      const edge = String(report.edge ?? "").slice(0, 40);
      const sides =
        report.sides
          ?.map((s) => `${s.team}:${s.keyPlayers?.length ?? 0}`)
          .join(",") ?? "";
      return `${game}:${edge}:${sides}`;
    })
    .join("|");
}

function computeSlateFingerprint(
  built: BuiltChatContext,
  opts?: { injuryDigest?: string; gameStatusDigest?: string },
): string {
  const { context, propPool } = built;
  const odds = context.realOdds ?? [];
  const kickoffs = odds
    .map((o) => o.startsAt ?? "")
    .filter(Boolean)
    .sort()
    .slice(0, 32)
    .join("|");
  const prices = odds
    .slice(0, 80)
    .map((o) => `${o.game}:${o.market}:${o.pick}:${o.odds}`)
    .join(";");
  const inj = opts?.injuryDigest ?? "";
  const status = opts?.gameStatusDigest ?? "";
  return `${odds.length}:${propPool.length}:${kickoffs}:${prices}:${inj}:${status}`;
}

/** Fingerprint of odds, props, kickoffs, and injuries for change detection. */
export function slateFingerprintFromBuilt(built: BuiltChatContext): string {
  return computeSlateFingerprint(built, {
    injuryDigest: computeInjuryDigest(
      built.context.matchupInjuries as Record<string, GameInjuryReport> | undefined,
    ),
  });
}

export function cachedSeedMatchesBuilt(
  seed: SlatePreAnalysisSeed | null | undefined,
  built: BuiltChatContext,
): boolean {
  if (!seed?.fingerprint) return false;
  return seed.fingerprint === slateFingerprintFromBuilt(built);
}

/** Cached tickets may flash instantly but must not finalize delivery. */
export function markBoardScanAsPreview<T extends { scanComplete?: boolean }>(scan: T): T {
  return { ...scan, scanComplete: false };
}

/** Live board scan covers every supported sport (minus user exclusions). */
export function coachLiveScanSports(excluded?: ReadonlySet<string> | readonly string[]): string[] {
  const ex =
    excluded instanceof Set
      ? excluded
      : new Set((excluded as readonly string[] | undefined) ?? []);
  return LIVE_SCAN_SPORT_IDS.filter((s) => !ex.has(s));
}
