import { Router, type IRouter } from "express";
import { cachedJson } from "../lib/sports";

const router: IRouter = Router();

const MLB = "baseball/mlb";

// ESPN exposes bats/throws only as the combined "Bats/Throws" display string
// on the athlete bio (e.g. "Right/Right", "Left/Right", "Switch/Right").
// Parse it into the two hands. Returns nulls when absent.
function parseBatsThrows(raw: string | undefined | null): { bats: string | null; throws: string | null } {
  if (!raw || typeof raw !== "string" || !raw.includes("/")) return { bats: null, throws: null };
  const [bats, throws] = raw.split("/").map((s) => s.trim());
  return { bats: bats || null, throws: throws || null };
}

type Bio = { athlete?: { displayBatsThrows?: string }; displayBatsThrows?: string };

async function fetchBatsThrows(athleteId: string): Promise<{ bats: string | null; throws: string | null }> {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${MLB}/athletes/${athleteId}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN athlete bio ${r.status}`);
  const data = (await r.json()) as Bio;
  const a = data.athlete ?? data;
  return parseBatsThrows(a?.displayBatsThrows);
}

type SplitsResp = {
  labels?: string[];
  splitCategories?: Array<{ name?: string; splits?: Array<{ displayName?: string; stats?: string[] }> }>;
};

// Map a split's stats[] (positionally aligned to the top-level labels[]) into a
// compact { label: number } object, keeping only finite numeric values. Rate
// stats like ".241" parse to 0.241; counting stats parse straight through.
function statsToMap(labels: string[], stats: string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(stats)) return out;
  labels.forEach((lab, i) => {
    const raw = stats[i];
    if (raw == null) return;
    const n = Number(raw);
    if (Number.isFinite(n)) out[lab] = n;
  });
  return out;
}

// GET /sports/mlb-batter-splits?athleteId=  -> { athleteId, bats, vsLeft, vsRight }
// Real platoon splits (season-to-date vs LHP / vs RHP) plus the batter's
// handedness, both from ESPN. Honest nulls when the feed has no data.
router.get("/sports/mlb-batter-splits", async (req, res): Promise<void> => {
  const athleteId = String(req.query.athleteId || "");
  if (!athleteId) {
    res.status(400).json({ error: "athleteId required" });
    return;
  }
  try {
    const key = `mlb-batter-splits:${athleteId}`;
    const out = await cachedJson(key, 60 * 60 * 1000, async () => {
      const [bt, splits] = await Promise.all([
        fetchBatsThrows(athleteId).catch(() => ({ bats: null, throws: null })),
        fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${MLB}/athletes/${athleteId}/splits`)
          .then((r) => (r.ok ? (r.json() as Promise<SplitsResp>) : null))
          .catch(() => null),
      ]);
      const labels = splits?.labels ?? [];
      const breakdown = splits?.splitCategories?.find((c) => c.name === "byBreakdown");
      const findSplit = (name: string) => breakdown?.splits?.find((s) => s.displayName === name);
      const vsLeftRaw = findSplit("vs. Left");
      const vsRightRaw = findSplit("vs. Right");
      const vsLeft = vsLeftRaw ? statsToMap(labels, vsLeftRaw.stats) : {};
      const vsRight = vsRightRaw ? statsToMap(labels, vsRightRaw.stats) : {};
      return {
        athleteId,
        bats: bt.bats,
        vsLeft: Object.keys(vsLeft).length ? vsLeft : null,
        vsRight: Object.keys(vsRight).length ? vsRight : null,
      };
    });
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch mlb batter splits");
    res.json({ athleteId, bats: null, vsLeft: null, vsRight: null });
  }
});

type ScoreboardResp = {
  events?: Array<{
    competitions?: Array<{
      competitors?: Array<{
        team?: { id?: string };
        probables?: Array<{ athlete?: { id?: string; displayName?: string } }>;
      }>;
    }>;
  }>;
};

// GET /sports/mlb-probables -> { probables: { "<teamId>": { name, athleteId, throws } } }
// Today's probable starting pitchers per team, with throwing hand resolved
// from each pitcher's bio (the scoreboard payload omits handedness). Cached
// 30min so repeat sends in the same window are cheap.
router.get("/sports/mlb-probables", async (req, res): Promise<void> => {
  try {
    const out = await cachedJson("mlb-probables", 30 * 60 * 1000, async () => {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${MLB}/scoreboard`);
      if (!r.ok) throw new Error(`ESPN scoreboard ${r.status}`);
      const data = (await r.json()) as ScoreboardResp;
      const byTeam: Record<string, { name: string; athleteId: string; throws: string | null }> = {};
      for (const ev of data.events ?? []) {
        for (const c of ev.competitions?.[0]?.competitors ?? []) {
          const teamId = c.team?.id;
          const p = c.probables?.[0]?.athlete;
          if (teamId && p?.id) {
            byTeam[teamId] = { name: p.displayName ?? "", athleteId: String(p.id), throws: null };
          }
        }
      }
      // Resolve each unique pitcher's throwing hand from their bio.
      const uniqueIds = Array.from(new Set(Object.values(byTeam).map((p) => p.athleteId)));
      const throwsById: Record<string, string | null> = {};
      await Promise.all(
        uniqueIds.map(async (id) => {
          try { throwsById[id] = (await fetchBatsThrows(id)).throws; } catch { throwsById[id] = null; }
        }),
      );
      for (const teamId of Object.keys(byTeam)) {
        byTeam[teamId].throws = throwsById[byTeam[teamId].athleteId] ?? null;
      }
      return { probables: byTeam };
    });
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch mlb probables");
    res.json({ probables: {} });
  }
});

export default router;
