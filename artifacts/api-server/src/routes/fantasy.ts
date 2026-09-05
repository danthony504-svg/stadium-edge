import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson } from "../lib/sports";

const router: IRouter = Router();

type EspnFantasyGameLog = {
  events?: Record<string, { gameDate?: string; opponent?: { displayName?: string }; atVs?: string }>;
  seasonTypes?: Array<{
    categories?: Array<{
      name?: string;
      displayName?: string;
      labels?: string[];
      names?: string[];
      events?: Array<{ eventId?: string; stats?: string[] }>;
    }>;
  }>;
  labels?: string[];
  names?: string[];
};

// This is intentionally a separate Fantasy endpoint. The sports Coach's
// flattened player-history format has legacy ambiguous labels (e.g. YDS across
// passing/rushing/receiving); changing it would risk betting analysis behavior.
router.get("/sports/fantasy/nfl-player-history", async (req, res): Promise<void> => {
  const athleteId = String(req.query.athleteId ?? "").trim();
  if (!athleteId) {
    res.status(400).json({ error: "athleteId required" });
    return;
  }
  try {
    const path = ESPN_SPORT_PATHS.nfl;
    const data = await cachedJson<EspnFantasyGameLog>(
      `fantasy:nfl:gamelog:${athleteId}`,
      30 * 60 * 1000,
      async () => {
        const response = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${athleteId}/gamelog`);
        if (!response.ok) throw new Error(`ESPN gamelog ${response.status}`);
        return response.json() as Promise<EspnFantasyGameLog>;
      },
    );
    const games = new Map<string, {
      eventId: string; date: string | null; opponent: string | null; isHome: boolean | null;
      categories: Record<string, Record<string, string>>;
    }>();
    for (const season of data.seasonTypes ?? []) for (const category of season.categories ?? []) {
      const categoryName = String(category.name ?? category.displayName ?? "").trim().toLowerCase();
      if (!categoryName) continue;
      const labels = category.labels ?? category.names ?? data.labels ?? data.names ?? [];
      for (const event of category.events ?? []) {
        if (!event.eventId) continue;
        const meta = data.events?.[event.eventId];
        const previous = games.get(event.eventId);
        const row = previous ?? {
          eventId: event.eventId,
          date: meta?.gameDate ?? null,
          opponent: meta?.opponent?.displayName ?? null,
          isHome: meta?.atVs === "vs" ? true : meta?.atVs === "@" ? false : null,
          categories: {},
        };
        row.categories[categoryName] = Object.fromEntries(
          (event.stats ?? []).map((value, index) => [String(labels[index] ?? index), String(value)]),
        );
        games.set(event.eventId, row);
      }
    }
    res.json({ athleteId, source: "ESPN athlete gamelog", games: [...games.values()].sort((a, b) =>
      (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0),
    ) });
  } catch (error) {
    req.log.warn({ error, athleteId }, "fantasy NFL game log unavailable");
    res.json({ athleteId, source: "ESPN athlete gamelog", games: [] });
  }
});

export default router;
