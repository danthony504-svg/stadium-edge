import { Router, type IRouter } from "express";
import { cachedJson } from "../lib/sports";
import { getPitcherStatcastMap, lookupPitcherStatcast } from "../lib/statcast";

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
// Ballpark HR park factors + altitude + coordinates (static public reference).
// hrIndex is a multi-year HR park-factor index where 100 = MLB average (>100
// boosts home runs, <100 suppresses). These are established public reference
// values, NOT a fabricated per-game number. altitudeFt and lat/lon are real
// stadium facts; dome marks fixed/retractable-roof parks (weather neutral).
// Keyed by ESPN team abbreviation.
// ----------------------------------------------------------------------------
type Park = { hrIndex: number; altitudeFt: number; dome: boolean; lat: number; lon: number };
const MLB_PARKS: Record<string, Park> = {
  ARI: { hrIndex: 103, altitudeFt: 1059, dome: true, lat: 33.4455, lon: -112.0667 },
  ATL: { hrIndex: 101, altitudeFt: 1050, dome: false, lat: 33.8907, lon: -84.4677 },
  BAL: { hrIndex: 104, altitudeFt: 33, dome: false, lat: 39.2839, lon: -76.6217 },
  BOS: { hrIndex: 108, altitudeFt: 20, dome: false, lat: 42.3467, lon: -71.0972 },
  CHC: { hrIndex: 103, altitudeFt: 600, dome: false, lat: 41.9484, lon: -87.6553 },
  CHW: { hrIndex: 104, altitudeFt: 595, dome: false, lat: 41.83, lon: -87.6339 },
  CIN: { hrIndex: 112, altitudeFt: 490, dome: false, lat: 39.0975, lon: -84.5069 },
  CLE: { hrIndex: 98, altitudeFt: 660, dome: false, lat: 41.4962, lon: -81.6852 },
  COL: { hrIndex: 115, altitudeFt: 5200, dome: false, lat: 39.7559, lon: -104.9942 },
  DET: { hrIndex: 94, altitudeFt: 600, dome: false, lat: 42.339, lon: -83.0485 },
  HOU: { hrIndex: 104, altitudeFt: 40, dome: true, lat: 29.7572, lon: -95.3556 },
  KC: { hrIndex: 95, altitudeFt: 750, dome: false, lat: 39.0517, lon: -94.4803 },
  LAA: { hrIndex: 101, altitudeFt: 153, dome: false, lat: 33.8003, lon: -117.8827 },
  LAD: { hrIndex: 101, altitudeFt: 522, dome: false, lat: 34.0739, lon: -118.24 },
  MIA: { hrIndex: 93, altitudeFt: 10, dome: true, lat: 25.7781, lon: -80.2197 },
  MIL: { hrIndex: 105, altitudeFt: 635, dome: true, lat: 43.0280, lon: -87.9712 },
  MIN: { hrIndex: 99, altitudeFt: 815, dome: false, lat: 44.9817, lon: -93.2776 },
  NYM: { hrIndex: 97, altitudeFt: 20, dome: false, lat: 40.7571, lon: -73.8458 },
  NYY: { hrIndex: 110, altitudeFt: 55, dome: false, lat: 40.8296, lon: -73.9262 },
  OAK: { hrIndex: 92, altitudeFt: 30, dome: false, lat: 38.5803, lon: -121.5133 },
  ATH: { hrIndex: 92, altitudeFt: 30, dome: false, lat: 38.5803, lon: -121.5133 },
  PHI: { hrIndex: 107, altitudeFt: 60, dome: false, lat: 39.9061, lon: -75.1665 },
  PIT: { hrIndex: 96, altitudeFt: 730, dome: false, lat: 40.4469, lon: -80.0057 },
  SD: { hrIndex: 95, altitudeFt: 62, dome: false, lat: 32.7073, lon: -117.157 },
  SEA: { hrIndex: 92, altitudeFt: 10, dome: true, lat: 47.5914, lon: -122.3325 },
  SF: { hrIndex: 90, altitudeFt: 10, dome: false, lat: 37.7786, lon: -122.3893 },
  STL: { hrIndex: 96, altitudeFt: 465, dome: false, lat: 38.6226, lon: -90.1928 },
  TB: { hrIndex: 96, altitudeFt: 15, dome: true, lat: 27.7682, lon: -82.6534 },
  TEX: { hrIndex: 102, altitudeFt: 545, dome: true, lat: 32.7473, lon: -97.0832 },
  TOR: { hrIndex: 103, altitudeFt: 250, dome: true, lat: 43.6414, lon: -79.3894 },
  WSH: { hrIndex: 100, altitudeFt: 25, dome: false, lat: 38.873, lon: -77.0074 },
};

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
