import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson, rateLimit } from "../lib/sports";

const router: IRouter = Router();

router.use("/sports/athletes", rateLimit({ windowMs: 60_000, max: 30, name: "athletes" }));

const normalizeName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

type EspnTeamsResp = {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{ team?: { id?: string } }>;
    }>;
  }>;
};

type EspnRoster = {
  athletes?: Array<
    | { fullName?: string; displayName?: string; headshot?: { href?: string } | string }
    | { items?: Array<{ fullName?: string; displayName?: string; headshot?: { href?: string } | string }> }
  >;
};

async function fetchTeamIds(espnPath: string): Promise<string[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams`;
  const data = await cachedJson<EspnTeamsResp>(
    `teams:${espnPath}`,
    24 * 60 * 60 * 1000,
    async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN teams ${r.status}`);
      return (await r.json()) as EspnTeamsResp;
    },
  );
  const ids: string[] = [];
  for (const sp of data.sports ?? []) {
    for (const lg of sp.leagues ?? []) {
      for (const t of lg.teams ?? []) {
        if (t.team?.id) ids.push(t.team.id);
      }
    }
  }
  return ids;
}

async function fetchRoster(
  espnPath: string,
  teamId: string,
): Promise<Array<{ name: string; href: string }>> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${teamId}/roster`;
  const data = await cachedJson<EspnRoster>(
    `roster:${espnPath}:${teamId}`,
    6 * 60 * 60 * 1000,
    async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN roster ${r.status}`);
      return (await r.json()) as EspnRoster;
    },
  );
  const out: Array<{ name: string; href: string }> = [];
  // ESPN roster shape varies: athletes can be a flat array of players or
  // a grouped array of { items: [...] } (NFL, MLB).
  const top = data.athletes ?? [];
  for (const entry of top) {
    if ((entry as { items?: unknown[] }).items) {
      for (const a of (entry as { items: Array<{ fullName?: string; displayName?: string; headshot?: { href?: string } | string }> }).items) {
        const name = a.fullName ?? a.displayName;
        const href = typeof a.headshot === "string" ? a.headshot : a.headshot?.href;
        if (name && href) out.push({ name, href });
      }
    } else {
      const a = entry as { fullName?: string; displayName?: string; headshot?: { href?: string } | string };
      const name = a.fullName ?? a.displayName;
      const href = typeof a.headshot === "string" ? a.headshot : a.headshot?.href;
      if (name && href) out.push({ name, href });
    }
  }
  return out;
}

router.get("/sports/athletes", async (req, res): Promise<void> => {
  const sport = String(req.query["sport"] || "").toLowerCase();
  const espnPath = ESPN_SPORT_PATHS[sport];
  if (!espnPath) {
    res.status(400).json({ error: `Unsupported sport: ${sport}` });
    return;
  }
  try {
    const photos = await cachedJson<Record<string, string>>(
      `athletes:${sport}`,
      6 * 60 * 60 * 1000,
      async () => {
        const teamIds = await fetchTeamIds(espnPath);
        // Cap to 40 teams to bound work for college leagues with hundreds.
        const ids = teamIds.slice(0, 40);
        const rosters = await Promise.all(
          ids.map((id) => fetchRoster(espnPath, id).catch(() => [] as Array<{ name: string; href: string }>)),
        );
        const map: Record<string, string> = {};
        for (const list of rosters) {
          for (const { name, href } of list) {
            map[normalizeName(name)] = href;
          }
        }
        return map;
      },
    );
    res.json({ sport, count: Object.keys(photos).length, photos });
  } catch (err) {
    req.log?.error?.({ err }, "athletes lookup failed");
    res.status(502).json({ error: "Athlete lookup failed" });
  }
});

export default router;
