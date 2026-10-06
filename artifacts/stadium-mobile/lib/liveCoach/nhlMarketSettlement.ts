/**
 * NHL Live Coach Phase 3A — market settlement horizon.
 *
 * Before grading ML / puck line / total, determine whether the posted
 * sportsbook market includes regulation only, OT, and/or shootout.
 * Ambiguous → reject (never assume).
 */

export type NhlSettlementHorizon =
  | "regulation_only"
  | "through_ot"
  | "through_shootout";

export type NhlSettlementResolution =
  | {
      ok: true;
      horizon: NhlSettlementHorizon;
      includesOt: boolean;
      includesShootout: boolean;
    }
  | { ok: false; reason: string };

/**
 * Resolve settlement semantics for a live NHL main.
 *
 * US ESPN pickcenter full-game mains (no period/regulation tags):
 * - Moneyline (2-way): includes OT + shootout
 * - Spread / Puck Line / Total: includes OT goals, excludes shootout
 *
 * Explicit regulation-only / 60-minute labels are rejected — live board has
 * no 3-way draw price, so we cannot settle them honestly.
 */
export function resolveNhlLiveMarketSettlement(opts: {
  market: string | null | undefined;
  pick?: string | null;
}): NhlSettlementResolution {
  const market = String(opts.market ?? "").trim().toLowerCase();
  const pick = String(opts.pick ?? "").trim().toLowerCase();
  const blob = `${market} ${pick}`;

  if (!market) return { ok: false, reason: "nhl_settlement_unknown_market" };

  // Never treat period / alt / props as full-game settlement.
  if (
    /\b(alt|alternate|p[123]|period|1st|2nd|3rd|prop|player)\b/.test(blob) &&
    !/\bpuck\s*line\b/.test(blob)
  ) {
    if (/\b(p[123]|period|1st|2nd|3rd)\b/.test(market)) {
      return { ok: false, reason: "nhl_settlement_period_market" };
    }
  }

  // Explicit regulation-only → reject (no live 3-way draw on board).
  if (
    /\bregulation\b/.test(blob) ||
    /\b60\s*(?:min|minutes?)\b/.test(blob) ||
    /\breg(?:ulation)?(?:\s+time)?\s+only\b/.test(blob) ||
    /\bexcl(?:uding|\.)?\s*(?:ot|overtime|shootout|so)\b/.test(blob)
  ) {
    return { ok: false, reason: "nhl_settlement_regulation_only_unsupported" };
  }

  const isMl = market === "moneyline" || market === "ml" || /\bml\b/.test(pick);
  const isSpread =
    market === "spread" ||
    market === "puck line" ||
    market === "puckline" ||
    market === "puck_line";
  const isTotal = market === "total";

  if (!isMl && !isSpread && !isTotal) {
    return { ok: false, reason: "nhl_settlement_unknown_market" };
  }

  // Explicit through-shootout language on any main.
  if (/\b(?:incl(?:udes?|\.)?\s+)?(?:ot\/?so|overtime\s*(?:and|&|\/)\s*shootout|shootout)\b/.test(blob) && isMl) {
    return {
      ok: true,
      horizon: "through_shootout",
      includesOt: true,
      includesShootout: true,
    };
  }

  // Explicit OT-only (no SO) — common for puck line / totals wording.
  if (/\bincl(?:udes?|\.)?\s+ot\b/.test(blob) && !/\bshootout|\bso\b/.test(blob)) {
    return {
      ok: true,
      horizon: "through_ot",
      includesOt: true,
      includesShootout: false,
    };
  }

  if (isMl) {
    // Standard US 2-way NHL moneyline from ESPN pickcenter.
    return {
      ok: true,
      horizon: "through_shootout",
      includesOt: true,
      includesShootout: true,
    };
  }

  if (isSpread || isTotal) {
    // Puck line / game total: OT goals count, shootout does not.
    return {
      ok: true,
      horizon: "through_ot",
      includesOt: true,
      includesShootout: false,
    };
  }

  return { ok: false, reason: "nhl_settlement_undetermined" };
}
