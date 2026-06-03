import { Router, type IRouter } from "express";
import { GetWeatherQueryParams, GetWeatherResponse } from "@workspace/api-zod";
import { cachedJson, rateLimit } from "../lib/sports";

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

export default router;
