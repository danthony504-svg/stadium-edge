import type { PlayerProp, PropSimulationResult } from "./api";

type Side = "Over" | "Under";

type PositionCandidate = {
  prop: PlayerProp;
  position: string;
  athleteId: string;
  line: number;
  side: Side;
};

const hasQuote = (price: number | null) => price != null && Number.isFinite(price) && price !== 0;

function propKey(player: string, market: string, line: number, side: Side) {
  return JSON.stringify([player, market, line, side]);
}

export function positionRankingCandidates(props: readonly PlayerProp[]): PositionCandidate[] {
  const candidates = new Map<string, PositionCandidate>();
  const ambiguous = new Set<string>();
  for (const prop of props) {
    const { athleteId, line } = prop;
    const position = prop.position?.trim().toUpperCase();
    if (!athleteId || !position || prop.alt || line == null || !Number.isFinite(line)) continue;

    const side = hasQuote(prop.overPrice) ? "Over" : hasQuote(prop.underPrice) ? "Under" : null;
    if (!side) continue;
    // Simulation responses are keyed by name, market, line and side inside a game.
    const key = JSON.stringify([prop.player, prop.market, line]);
    const existing = candidates.get(key);
    if (existing && existing.athleteId !== athleteId) ambiguous.add(key);
    else if (!existing) candidates.set(key, { prop, position, athleteId, line, side });
  }
  return [...candidates.entries()].filter(([key]) => !ambiguous.has(key)).map(([, candidate]) => candidate);
}

export function topPlayersByPosition<Game>(
  boards: readonly {
    game: Game;
    candidates: readonly PositionCandidate[];
    simulations: readonly PropSimulationResult[];
  }[],
) {
  const ranked: (PositionCandidate & { game: Game; probability: number; sampleGames: number })[] = [];
  for (const { game, candidates, simulations } of boards) {
    const byKey = new Map(simulations.map(row => [propKey(row.player, row.market, row.line, row.side), row]));
    for (const candidate of candidates) {
      const { prop, line, side } = candidate;
      const row = byKey.get(propKey(prop.player, prop.market, line, side));
      if (!row || row.nullReason || !(row.sampleGames > 0) || !(row.simulations > 0)) continue;

      let best: { side: Side; probability: number } | undefined;
      for (const postedSide of ["Over", "Under"] as const) {
        if (!hasQuote(postedSide === "Over" ? prop.overPrice : prop.underPrice)) continue;
        // Reuse the shared draws' exact side-specific rates, including pushes.
        const probability = row.lineHitRatesBySide?.[postedSide]?.[String(line)]
          ?? (postedSide === side ? row.hitProbability : null);
        if (probability == null || !Number.isFinite(probability) || probability <= 0 || probability > 1) continue;
        if (!best || probability > best.probability) best = { side: postedSide, probability };
      }
      if (best) ranked.push({ ...candidate, ...best, game, sampleGames: row.sampleGames });
    }
  }

  ranked.sort((a, b) => b.probability - a.probability || b.sampleGames - a.sampleGames || a.prop.player.localeCompare(b.prop.player));
  const positions = new Map<string, typeof ranked>();
  const seen = new Set<string>();
  for (const player of ranked) {
    if (seen.has(player.athleteId)) continue;
    seen.add(player.athleteId);
    const group = positions.get(player.position) ?? [];
    if (group.length < 2) {
      group.push(player);
      positions.set(player.position, group);
    }
  }
  return [...positions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([position, players]) => ({ position, players }));
}

export async function collectPositionSimulations<Request>(
  requests: readonly Request[],
  fetchBatch: (chunk: Request[]) => Promise<readonly PropSimulationResult[]>,
  signal: AbortSignal,
) {
  const simulations: PropSimulationResult[] = [];
  let incomplete = false;
  const batchSize = 40;
  const checkCancelled = () => {
    if (!signal.aborted) return;
    const error = new Error("Player prop simulations cancelled");
    error.name = "AbortError";
    throw error;
  };
  for (let offset = 0; offset < requests.length; offset += batchSize) {
    checkCancelled();
    const chunk = requests.slice(offset, offset + batchSize);
    try {
      const rows = await fetchBatch(chunk);
      simulations.push(...rows);
      if (rows.length !== chunk.length) incomplete = true;
    } catch (error) {
      checkCancelled();
      incomplete = true;
      if (error instanceof Error && error.message.startsWith("HTTP 429")) break;
    }
  }
  return { simulations, incomplete };
}
