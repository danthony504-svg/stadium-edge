/**
 * Derive isHome + opponentTeamId from ESPN team ids only.
 * Never infers from player names or matchup strings.
 */

export type PropSideContext = {
  isHome: boolean | null;
  opponentTeamId: string | null;
  playerTeamId: string | null;
};

/**
 * Map a player's own team id onto the game's home/away ids.
 * Returns nulls when ids are missing or the player is not on either side.
 */
export function deriveSideFromTeamIds(
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
  playerTeamId: string | null | undefined,
): PropSideContext {
  const home = String(homeTeamId ?? "").trim();
  const away = String(awayTeamId ?? "").trim();
  const own = String(playerTeamId ?? "").trim();
  if (!home || !away || !own || home === away) {
    return { isHome: null, opponentTeamId: null, playerTeamId: own || null };
  }
  if (own === home) {
    return { isHome: true, opponentTeamId: away, playerTeamId: own };
  }
  if (own === away) {
    return { isHome: false, opponentTeamId: home, playerTeamId: own };
  }
  return { isHome: null, opponentTeamId: null, playerTeamId: own };
}

/** Stamp side context onto a prop-like object when team ids are known. */
export function stampPropSideContext<
  T extends {
    isHome?: boolean | null;
    opponentTeamId?: string | null;
    playerTeamId?: string | null;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
  },
>(
  prop: T,
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
  playerTeamId?: string | null,
): T & PropSideContext & { homeTeamId: string | null; awayTeamId: string | null } {
  const home = String(homeTeamId ?? prop.homeTeamId ?? "").trim() || null;
  const away = String(awayTeamId ?? prop.awayTeamId ?? "").trim() || null;
  const own =
    String(playerTeamId ?? prop.playerTeamId ?? "").trim() || null;
  const side = deriveSideFromTeamIds(home, away, own);
  // Complete team IDs are authoritative even when they disprove old context.
  const authoritative = Boolean(home && away && own);
  return {
    ...prop,
    homeTeamId: home,
    awayTeamId: away,
    playerTeamId: side.playerTeamId,
    // Incomplete IDs can retain caller context; contradictory IDs cannot.
    isHome: authoritative ? side.isHome : side.isHome ?? prop.isHome ?? null,
    opponentTeamId: authoritative ? side.opponentTeamId : side.opponentTeamId ?? prop.opponentTeamId ?? null,
  };
}
