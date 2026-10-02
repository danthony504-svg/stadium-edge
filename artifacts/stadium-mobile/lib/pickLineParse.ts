/**
 * Parse the numeric line from a pick string.
 *
 * Prefer the TRAILING number so nicknames like "49ers" / "76ers" are never
 * mistaken for the handicap. Phone: Charlotte "49ers +27.5" showed BEST LINE
 * "+49" because a first-number grab matched the team name.
 *
 * - "49ers +27.5" → 27.5
 * - "Knicks -3.5" → -3.5
 * - "Over 8.5" → 8.5
 * - "49ers" (moneyline) → null
 */

export function parsePickLineNumber(pick: string | null | undefined): number | null {
  const n = String(pick ?? "").trim().toLowerCase();
  if (!n) return null;
  const m = n.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const v = parseFloat(m[1]!);
  return Number.isFinite(v) ? v : null;
}

/**
 * Short line label for Safe / Best / Value chips.
 * Spreads keep the sign ("+27.5"); totals/props use O/U when side is known.
 */
export function compactPickLineLabel(
  pick: string | null | undefined,
  side: "Over" | "Under" | null = null,
): string | null {
  const n = String(pick ?? "").trim().toLowerCase();
  if (!n) return null;
  const m = n.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const raw = m[1]!;
  if (side === "Over") return `O ${raw.replace(/^\+/, "")}`;
  if (side === "Under") return `U ${raw.replace(/^\+/, "")}`;
  if (raw.startsWith("+") || raw.startsWith("-")) return raw;
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  return v > 0 ? `+${raw}` : raw;
}
