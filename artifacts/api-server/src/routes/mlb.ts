import { Router, type IRouter } from "express";
import { cachedJson } from "../lib/sports";
import { getPitcherStatcastMap, lookupPitcherStatcast } from "../lib/statcast";
import { MLB_PARKS } from "../lib/parks";

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

// ----------------------------------------------------------------------------
// Pitcher season tendency (REAL ESPN data — never fabricated).
// Pulls the probable starter's season pitching line and derives the signals
// that actually matter for HR / strikeout props: HR allowed (+ HR/9), strikeout
// rate (K/9), fly-ball lean (FB share + ground/fly ratio) and how hard he gets
// hit (opponent OPS). All honest nulls when ESPN has no line yet.
// IMPORTANT: ESPN does NOT publish Statcast (barrel rate, exit velocity, launch
// angle, hard-hit %, pitch-type mix). Those are intentionally absent here.
// ----------------------------------------------------------------------------
type StatsCategory = {
  name?: string;
  labels?: string[];
  totals?: string[];
  statistics?: Array<{ season?: { year?: number }; stats?: string[] }>;
};
type StatsResp = { categories?: StatsCategory[] };

// ESPN's category.totals is the player's CAREER line; the per-season rows live
// in category.statistics keyed by season.year. For a tendency we want ONLY the
// most recent season's line (current form). We deliberately do NOT fall back to
// career totals — that would mislabel a career number as season tendency, which
// breaks the never-fabricate / honest-null principle. No season row => null.
function latestSeasonStats(c?: StatsCategory): string[] | null {
  if (!c) return null;
  const rows = c.statistics;
  if (!Array.isArray(rows) || !rows.length) return null;
  let best: string[] | null = null;
  let bestYr = -Infinity;
  for (const r of rows) {
    const y = r.season?.year ?? -Infinity;
    if (y >= bestYr && Array.isArray(r.stats)) {
      bestYr = y;
      best = r.stats;
    }
  }
  return best;
}

export type PitcherTendency = {
  era: number | null;
  whip: number | null;
  ip: number | null;
  kPer9: number | null;
  hrAllowed: number | null;
  hrPer9: number | null;
  flyBallPct: number | null; // FB / (GB + FB), 0..1
  groundFlyRatio: number | null; // ESPN G/F
  oppOPS: number | null; // opponent OPS against (OOPS)
  // Statcast (Baseball Savant) batted-ball-ALLOWED profile — REAL data Savant
  // publishes but ESPN does not. Joined by pitcher name; null when absent.
  barrelPctAllowed: number | null; // %, barrels allowed / batted-ball events
  hardHitPctAllowed: number | null; // %, batted balls allowed >= 95 mph EV
  battedBallEvents: number | null; // Statcast sample size (small = noisy)
};

async function fetchPitcherTendency(athleteId: string): Promise<PitcherTendency | null> {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${MLB}/athletes/${athleteId}/stats`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = (await r.json()) as StatsResp;
  const cats = data.categories ?? [];
  const val = (catName: string, label: string): number | null => {
    const c = cats.find((x) => x.name === catName);
    const stats = latestSeasonStats(c);
    if (!c?.labels || !stats) return null;
    const i = c.labels.indexOf(label);
    if (i < 0) return null;
    const n = Number(stats[i]);
    return Number.isFinite(n) ? n : null;
  };
  const era = val("pitching", "ERA");
  const whip = val("pitching", "WHIP");
  const ip = val("pitching", "IP");
  const kPer9 = val("expanded-pitching", "K/9");
  const hrAllowed = val("opponent-batting", "HR");
  const gb = val("expanded-pitching", "GB");
  const fb = val("expanded-pitching", "FB");
  const groundFlyRatio = val("expanded-pitching", "G/F");
  const oppOPS = val("opponent-batting", "OOPS");
  const hrPer9 = hrAllowed != null && ip != null && ip > 0 ? Math.round((hrAllowed * 9 / ip) * 100) / 100 : null;
  const flyBallPct = gb != null && fb != null && gb + fb > 0 ? Math.round((fb / (gb + fb)) * 100) / 100 : null;
  // No usable signal at all -> honest null entry rather than an all-null object.
  if (era == null && kPer9 == null && hrAllowed == null && oppOPS == null && flyBallPct == null) return null;
  return {
    era, whip, ip, kPer9, hrAllowed, hrPer9, flyBallPct, groundFlyRatio, oppOPS,
    barrelPctAllowed: null, hardHitPctAllowed: null, battedBallEvents: null,
  };
}

// ----------------------------------------------------------------------------
type ParkWeather = { tempF: number | null; condition: string | null; windMph: number | null; humidity: number | null } | null;
type OWMResp = {
  weather?: Array<{ main?: string; description?: string }>;
  main?: { temp?: number; humidity?: number };
  wind?: { speed?: number };
};

// Real OpenWeather current reading for a park's coordinates (imperial). This is
// a snapshot near "now", NOT a first-pitch forecast. Returns null when the key
// is missing or the upstream fails, and any individual field that is missing /
// unparseable is left null rather than guessed — callers stay honest and never
// fabricate a temperature, wind, humidity or condition.
async function fetchParkWeather(lat: number, lon: number): Promise<ParkWeather> {
  const apiKey = process.env["OPENWEATHER_API_KEY"];
  if (!apiKey) return null;
  try {
    const key = `mlb-wx:${lat.toFixed(2)}:${lon.toFixed(2)}`;
    return await cachedJson(key, 30 * 60 * 1000, async () => {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`OWM ${r.status}`);
      const d = (await r.json()) as OWMResp;
      const temp = d.main?.temp;
      const wind = d.wind?.speed;
      const hum = d.main?.humidity;
      return {
        tempF: typeof temp === "number" ? Math.round(temp) : null,
        condition: d.weather?.[0]?.description ?? d.weather?.[0]?.main ?? null,
        windMph: typeof wind === "number" ? Math.round(wind) : null,
        humidity: typeof hum === "number" ? Math.round(hum) : null,
      };
    });
  } catch {
    return null;
  }
}

type ScoreboardResp = {
  events?: Array<{
    competitions?: Array<{
      venue?: { fullName?: string };
      competitors?: Array<{
        homeAway?: string;
        team?: { id?: string; abbreviation?: string };
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
      const byTeam: Record<string, { name: string; athleteId: string; throws: string | null; tendency: PitcherTendency | null }> = {};
      // Per-game environment keyed by the home team's ESPN id: venue + static
      // park factor + REAL ballpark weather (skipped for domes).
      const games: Record<string, { homeAbbr: string | null; venue: string | null; park: { hrIndex: number; altitudeFt: number; dome: boolean } | null; weather: ParkWeather }> = {};
      for (const ev of data.events ?? []) {
        const comp = ev.competitions?.[0];
        for (const c of comp?.competitors ?? []) {
          const teamId = c.team?.id;
          const p = c.probables?.[0]?.athlete;
          if (teamId && p?.id) {
            byTeam[teamId] = { name: p.displayName ?? "", athleteId: String(p.id), throws: null, tendency: null };
          }
        }
        const home = comp?.competitors?.find((c) => c.homeAway === "home");
        const homeId = home?.team?.id;
        const homeAbbr = home?.team?.abbreviation ?? null;
        if (homeId) {
          const park = homeAbbr ? MLB_PARKS[homeAbbr] ?? null : null;
          games[homeId] = {
            homeAbbr,
            venue: comp?.venue?.fullName ?? null,
            park: park ? { hrIndex: park.hrIndex, altitudeFt: park.altitudeFt, dome: park.dome } : null,
            weather: park && !park.dome ? await fetchParkWeather(park.lat, park.lon) : null,
          };
        }
      }
      // Resolve each unique pitcher's throwing hand + season tendency once.
      const uniqueIds = Array.from(new Set(Object.values(byTeam).map((p) => p.athleteId)));
      const throwsById: Record<string, string | null> = {};
      const tendencyById: Record<string, PitcherTendency | null> = {};
      await Promise.all(
        uniqueIds.map(async (id) => {
          try { throwsById[id] = (await fetchBatsThrows(id)).throws; } catch { throwsById[id] = null; }
          try { tendencyById[id] = await fetchPitcherTendency(id); } catch { tendencyById[id] = null; }
        }),
      );
      // Join the REAL Statcast (Savant) barrel% / hard-hit% ALLOWED onto each
      // starter's tendency by name. Fail-closed: an empty map just leaves the
      // two fields null and downstream HR scoring degrades honestly.
      const statcastMap = await getPitcherStatcastMap().catch(() => new Map());
      for (const teamId of Object.keys(byTeam)) {
        const p = byTeam[teamId];
        p.throws = throwsById[p.athleteId] ?? null;
        let tend = tendencyById[p.athleteId] ?? null;
        const sc = lookupPitcherStatcast(statcastMap, p.name);
        if (sc && (sc.barrelPctAllowed != null || sc.hardHitPctAllowed != null)) {
          // A pitcher can have Statcast without an ESPN season line yet — build a
          // minimal tendency so the real barrel/hard-hit numbers aren't dropped.
          if (!tend) {
            tend = {
              era: null, whip: null, ip: null, kPer9: null, hrAllowed: null,
              hrPer9: null, flyBallPct: null, groundFlyRatio: null, oppOPS: null,
              barrelPctAllowed: null, hardHitPctAllowed: null, battedBallEvents: null,
            };
          }
          tend = {
            ...tend,
            barrelPctAllowed: sc.barrelPctAllowed,
            hardHitPctAllowed: sc.hardHitPctAllowed,
            battedBallEvents: sc.battedBallEvents,
          };
        }
        p.tendency = tend;
      }
      return { probables: byTeam, games };
    });
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch mlb probables");
    res.json({ probables: {} });
  }
});

export default router;
