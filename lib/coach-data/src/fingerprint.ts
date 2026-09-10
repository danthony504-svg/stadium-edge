import type { CoachLegFingerprintInput } from "@workspace/coach-types";

import type { CoachRawSlateInput } from "./types";

/** Odds-sensitive leg fingerprint — any price/line change produces a new hash. */
export function computeLegFingerprint(input: CoachLegFingerprintInput): string {
  const line = input.line == null ? "null" : String(input.line);
  const player = input.playerId ?? "";
  const alt = input.isAlt ? "1" : "0";
  return [
    input.sport,
    input.gameId,
    input.marketKey,
    input.pick,
    line,
    String(input.odds),
    player,
    alt,
  ].join(":");
}

export type ContextFingerprintInput = Pick<
  CoachRawSlateInput,
  "gameLines" | "props" | "injuryDigest" | "gameStatusDigest"
>;

/** Slate-level fingerprint — used to skip unchanged background scans. */
export function computeContextFingerprint(input: ContextFingerprintInput): string {
  const odds = [...input.gameLines].sort((a, b) =>
    `${a.gameId}:${a.marketKey}:${a.pick}`.localeCompare(`${b.gameId}:${b.marketKey}:${b.pick}`),
  );
  const kickoffs = odds
    .map((o) => o.startsAt ?? "")
    .filter(Boolean)
    .sort()
    .slice(0, 64)
    .join("|");
  const prices = odds
    .slice(0, 120)
    .map((o) => `${o.gameId}:${o.marketKey}:${o.pick}:${o.line}:${o.odds}`)
    .join(";");
  const propSample = [...input.props]
    .slice(0, 120)
    .map((p) => `${p.gameId}:${p.marketKey}:${p.playerId}:${p.side}:${p.line}:${p.odds}`)
    .join(";");
  const inj = input.injuryDigest ?? "";
  const status = input.gameStatusDigest ?? "";
  return `${odds.length}:${input.props.length}:${kickoffs}:${prices}:${propSample}:${inj}:${status}`;
}
