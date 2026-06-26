import { Router, type IRouter } from "express";
import {
  GetWeatherQueryParams,
  GetWeatherResponse,
  GetParkWeatherResponse,
} from "@workspace/api-zod";
import { cachedJson, rateLimit } from "../lib/sports";
import {
  MLB_PARKS,
  PARK_META,
  degToCompass,
  computeWeatherImpact,
} from "../lib/parks";

const router: IRouter = Router();

// Cap to 30/min/IP; cache key uses quantized lat/lon so bucket grows slowly.
router.use("/weather", rateLimit({ windowMs: 60_000, max: 30, name: "weather" }));

type OWMResponse = {
  name?: string;
  weather?: Array<{ main?: string; description?: string }>;
  main?: { temp?: number; humidity?: number };
  wind?: { speed?: number };
  clouds?: { all?: number };
  rain?: { "1h"?: number };
};

router.get("/weather", async (req, res): Promise<void> => {
  const parsed = GetWeatherQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { lat, lon } = parsed.data;
  const apiKey = process.env["OPENWEATHER_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "OPENWEATHER_API_KEY not configured" });
    return;
  }

  try {
    const cacheKey = `wx:${lat.toFixed(2)}:${lon.toFixed(2)}`;
    const data = await cachedJson(cacheKey, 10 * 60 * 1000, async () => {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`OWM ${r.status}`);
      return (await r.json()) as OWMResponse;
    });

    const out = {
      tempF: Math.round(data.main?.temp ?? 70),
      condition:
        data.weather?.[0]?.description ?? data.weather?.[0]?.main ?? "Clear",
      windMph: Math.round(data.wind?.speed ?? 0),
      humidity: Math.round(data.main?.humidity ?? 50),
      precipChance: Math.min(
        100,
        Math.round((data.rain?.["1h"] ?? 0) * 20 + (data.clouds?.all ?? 0) / 4),
      ),
      city: data.name ?? null,
    };

    res.json(GetWeatherResponse.parse(out));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch weather");
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Upstream error" });
  }
});

// ----------------------------------------------------------------------------
// GET /weather/parks?sport=mlb -> rich per-park weather report for every game
// on today's MLB slate. Returns REAL OpenWeather current conditions + a 5-day
// forecast plus a deterministic "AI Weather Impact" rating computed from those
// real values (never a fabricated percentage). Any field that OpenWeather does
// not return (e.g. wind gusts) is left null rather than guessed; a game whose
// home park we cannot resolve is skipped instead of invented.
// ----------------------------------------------------------------------------

type OWMCurrent = {
  weather?: Array<{ main?: string; description?: string }>;
  main?: {
    temp?: number;
    feels_like?: number;
    humidity?: number;
    pressure?: number;
  };
  wind?: { speed?: number; deg?: number; gust?: number };
  clouds?: { all?: number };
};

type OWMForecastSlot = {
  dt?: number;
  main?: { temp?: number; temp_max?: number; temp_min?: number };
  weather?: Array<{ main?: string; description?: string }>;
  wind?: { speed?: number };
  pop?: number; // probability of precipitation 0..1 (real)
};
type OWMForecast = {
  list?: OWMForecastSlot[];
  city?: { timezone?: number };
};

type ParkWeatherCurrent = {
  tempF: number | null;
  feelsLikeF: number | null;
  condition: string | null;
  windMph: number | null;
  windDeg: number | null;
  windDir: string | null;
  gustMph: number | null;
  humidity: number | null;
  pressureInHg: number | null;
  cloudCoverPct: number | null;
  precipChancePct: number | null;
};

type ParkWeatherDay = {
  date: string;
  label: string;
  hiF: number;
  loF: number;
  condition: string | null;
  precipChancePct: number | null;
  windMph: number | null;
};

type ParkWeatherReport = {
  gameId: string;
  homeAbbr: string;
  awayAbbr: string;
  homeTeam: string;
  awayTeam: string;
  parkName: string;
  city: string;
  commenceTime: string;
  climateControlled: boolean;
  current: ParkWeatherCurrent;
  impact: { rating: string; summary: string };
  forecast: ParkWeatherDay[];
};

type ScoreboardResp = {
  events?: Array<{
    id?: string;
    date?: string;
    competitions?: Array<{
      venue?: { fullName?: string };
      competitors?: Array<{
        homeAway?: string;
        team?: {
          abbreviation?: string;
          displayName?: string;
          shortDisplayName?: string;
        };
      }>;
    }>;
  }>;
};

// Title-case the OpenWeather "description" (e.g. "broken clouds" -> "Broken Clouds").
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pick the most frequent condition label across a day's forecast slots. Returns
// null when the feed gave us no labels — never a fabricated "Clear".
function dominantCondition(labels: string[]): string | null {
  if (labels.length === 0) return null;
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best = labels[0]!;
  let bestN = 0;
  for (const [l, n] of counts) {
    if (n > bestN) {
      best = l;
      bestN = n;
    }
  }
  return best;
}

function buildForecast(fc: OWMForecast): ParkWeatherDay[] {
  const tzSec = fc.city?.timezone ?? 0;
  const localDate = (dtSec: number) =>
    new Date((dtSec + tzSec) * 1000).toISOString().slice(0, 10);
  const nowLocal = localDate(Math.floor(Date.now() / 1000));
  const tomorrowLocal = localDate(Math.floor(Date.now() / 1000) + 86400);

  const byDay = new Map<
    string,
    { hi: number; lo: number; pops: number[]; winds: number[]; conds: string[] }
  >();
  for (const slot of fc.list ?? []) {
    if (typeof slot.dt !== "number") continue;
    const day = localDate(slot.dt);
    const entry =
      byDay.get(day) ??
      { hi: -Infinity, lo: Infinity, pops: [], winds: [], conds: [] };
    const tmax = slot.main?.temp_max ?? slot.main?.temp;
    const tmin = slot.main?.temp_min ?? slot.main?.temp;
    if (typeof tmax === "number") entry.hi = Math.max(entry.hi, tmax);
    if (typeof tmin === "number") entry.lo = Math.min(entry.lo, tmin);
    if (typeof slot.pop === "number") entry.pops.push(slot.pop);
    if (typeof slot.wind?.speed === "number") entry.winds.push(slot.wind.speed);
    const cond = slot.weather?.[0]?.description ?? slot.weather?.[0]?.main;
    if (cond) entry.conds.push(titleCase(cond));
    byDay.set(day, entry);
  }

  const days = Array.from(byDay.entries())
    .filter(([, v]) => v.hi !== -Infinity && v.lo !== Infinity)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 5)
    .map(([date, v]) => {
      let label: string;
      if (date === nowLocal) label = "Today";
      else if (date === tomorrowLocal) label = "Tomorrow";
      else
        label = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
          weekday: "short",
          timeZone: "UTC",
        });
      const precipChancePct = v.pops.length
        ? Math.round(Math.max(...v.pops) * 100)
        : null;
      const windMph = v.winds.length
        ? Math.round(v.winds.reduce((a, b) => a + b, 0) / v.winds.length)
        : null;
      return {
        date,
        label,
        hiF: Math.round(v.hi),
        loF: Math.round(v.lo),
        condition: dominantCondition(v.conds),
        precipChancePct,
        windMph,
      };
    });
  return days;
}

async function fetchParkReport(
  abbr: string,
  apiKey: string,
): Promise<{
  climateControlled: boolean;
  current: ParkWeatherCurrent;
  impact: { rating: string; summary: string };
  forecast: ParkWeatherDay[];
} | null> {
  const park = MLB_PARKS[abbr];
  if (!park) return null;
  const { lat, lon } = park;
  const key = `wx:report:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cachedJson(key, 12 * 60 * 1000, async () => {
    const base = "https://api.openweathermap.org/data/2.5";
    const [curRes, fcRes] = await Promise.all([
      fetch(`${base}/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
      fetch(`${base}/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
    ]);
    if (!curRes.ok) throw new Error(`OWM weather ${curRes.status}`);
    if (!fcRes.ok) throw new Error(`OWM forecast ${fcRes.status}`);
    const cur = (await curRes.json()) as OWMCurrent;
    const fc = (await fcRes.json()) as OWMForecast;

    const forecast = buildForecast(fc);
    // Current precip chance: use the nearest upcoming forecast slot's real pop.
    const nowSec = Math.floor(Date.now() / 1000);
    const nextSlot = (fc.list ?? [])
      .filter((s) => typeof s.dt === "number" && (s.dt as number) >= nowSec - 5400)
      .sort((a, b) => (a.dt as number) - (b.dt as number))[0];
    const precipChancePct =
      typeof nextSlot?.pop === "number" ? Math.round(nextSlot.pop * 100) : null;

    // Every field below is left null when OpenWeather omits it — we never
    // substitute a fabricated reading.
    const windDeg =
      typeof cur.wind?.deg === "number" ? Math.round(cur.wind.deg) : null;
    const windDir = windDeg != null ? degToCompass(windDeg) : null;
    const tempF =
      typeof cur.main?.temp === "number" ? Math.round(cur.main.temp) : null;
    const windMph =
      typeof cur.wind?.speed === "number" ? Math.round(cur.wind.speed) : null;
    const pressureHpa = cur.main?.pressure;
    const condRaw = cur.weather?.[0]?.description ?? cur.weather?.[0]?.main;

    const current: ParkWeatherCurrent = {
      tempF,
      feelsLikeF:
        typeof cur.main?.feels_like === "number"
          ? Math.round(cur.main.feels_like)
          : null,
      condition: condRaw ? titleCase(condRaw) : null,
      windMph,
      windDeg,
      windDir,
      gustMph:
        typeof cur.wind?.gust === "number" ? Math.round(cur.wind.gust) : null,
      humidity:
        typeof cur.main?.humidity === "number"
          ? Math.round(cur.main.humidity)
          : null,
      pressureInHg:
        typeof pressureHpa === "number"
          ? Math.round(pressureHpa * 0.02953 * 100) / 100
          : null,
      cloudCoverPct:
        typeof cur.clouds?.all === "number" ? Math.round(cur.clouds.all) : null,
      precipChancePct,
    };

    const impact = computeWeatherImpact({
      climateControlled: park.dome,
      tempF,
      precipChancePct,
      windMph,
      windDir,
    });

    return { climateControlled: park.dome, current, impact, forecast };
  });
}

router.get("/weather/parks", async (req, res): Promise<void> => {
  const sport = String(req.query["sport"] ?? "mlb").toLowerCase();
  if (sport !== "mlb") {
    // Park weather reports are MLB-only for now (open-air ballparks). Returning
    // an empty list keeps the contract honest rather than faking other sports.
    res.json([]);
    return;
  }
  const apiKey = process.env["OPENWEATHER_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "OPENWEATHER_API_KEY not configured" });
    return;
  }

  try {
    const reports = await cachedJson(
      "wx:parks:mlb",
      10 * 60 * 1000,
      async (): Promise<ParkWeatherReport[]> => {
        const r = await fetch(
          "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
        );
        if (!r.ok) throw new Error(`ESPN scoreboard ${r.status}`);
        const data = (await r.json()) as ScoreboardResp;

        const out: ParkWeatherReport[] = [];
        for (const ev of data.events ?? []) {
          const comp = ev.competitions?.[0];
          if (!comp) continue;
          const home = comp.competitors?.find((c) => c.homeAway === "home");
          const away = comp.competitors?.find((c) => c.homeAway === "away");
          const homeAbbr = home?.team?.abbreviation ?? null;
          const awayAbbr = away?.team?.abbreviation ?? null;
          if (!homeAbbr || !MLB_PARKS[homeAbbr]) continue; // skip unknown parks

          const report = await fetchParkReport(homeAbbr, apiKey);
          if (!report) continue;

          const meta = PARK_META[homeAbbr];
          out.push({
            gameId: String(ev.id ?? `${awayAbbr}@${homeAbbr}`),
            homeAbbr,
            awayAbbr: awayAbbr ?? "",
            homeTeam:
              home?.team?.displayName ?? home?.team?.shortDisplayName ?? homeAbbr,
            awayTeam:
              away?.team?.displayName ??
              away?.team?.shortDisplayName ??
              awayAbbr ??
              "",
            parkName: meta?.name ?? comp.venue?.fullName ?? homeAbbr,
            city: meta?.city ?? "",
            commenceTime: ev.date ?? "",
            climateControlled: report.climateControlled,
            current: report.current,
            impact: report.impact,
            forecast: report.forecast,
          });
        }
        return out;
      },
    );

    res.json(GetParkWeatherResponse.parse(reports));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch park weather reports");
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Upstream error" });
  }
});

export default router;
