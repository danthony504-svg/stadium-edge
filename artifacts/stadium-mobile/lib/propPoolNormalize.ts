import { propMarketLabel } from "./propMarketLabel";

/** Canonical prop-side shape at the API boundary (raw feed → pool rows). */
export type NormalizedPropSide = {
  propMarketKey: string;
  propMarketLabel: string;
  playerName: string;
  line: number | null;
  side: "Over" | "Under";
  odds: number;
};

/** Normalize one posted prop side; returns null when required fields are missing. */
export function normalizePropSide(input: {
  market?: string | null;
  player?: string | null;
  line?: number | null;
  side: "Over" | "Under";
  odds?: number | null;
}): NormalizedPropSide | null {
  const propMarketKey = typeof input.market === "string" ? input.market.trim() : "";
  const playerName = typeof input.player === "string" ? input.player.trim() : "";
  if (!propMarketKey || !playerName) return null;
  if (input.odds == null || !Number.isFinite(input.odds)) return null;
  return {
    propMarketKey,
    propMarketLabel: propMarketLabel(propMarketKey),
    playerName,
    line: input.line ?? null,
    side: input.side,
    odds: input.odds,
  };
}
