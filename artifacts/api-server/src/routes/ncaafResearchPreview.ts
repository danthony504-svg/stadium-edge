import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  buildNcaafResearchPreview,
  renderNcaafResearchPreview,
  type ResearchPreview,
} from "../lib/ncaafResearchPreview.js";

const router: IRouter = Router();
let cache: { expires: number; data: ResearchPreview } | undefined;
let pending: Promise<ResearchPreview> | undefined;
async function load(): Promise<ResearchPreview> {
  if (cache && cache.expires > Date.now()) return cache.data;
  if (pending) return pending;
  pending = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout='5s'");
      const forecasts = await client.query(
        "SELECT f.key,f.value,s.value AS settlement FROM (SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%' ORDER BY value->>'recordedAt' DESC,key LIMIT 64) f LEFT JOIN public.app_kv s ON s.key=replace(f.key,'research:ncaaf:forecast:','research:ncaaf:settlement:')",
      );
      const keys = [
        ...new Set(
          forecasts.rows
            .map((r) => r.value?.input?.liveSourceEvidence?.key)
            .filter(
              (k) =>
                typeof k === "string" &&
                k.startsWith("research:ncaaf:live-inputs:"),
            ),
        ),
      ];
      const sources = keys.length
        ? await client.query(
            "SELECT key,value FROM public.app_kv WHERE key=ANY($1::text[])",
            [keys],
          )
        : { rows: [] };
      const clock = await client.query("SELECT clock_timestamp() AS now");
      const data = buildNcaafResearchPreview(
        forecasts.rows,
        new Map(sources.rows.map((r) => [r.key, r.value])),
        clock.rows[0].now.toISOString(),
      );
      await client.query("COMMIT");
      cache = { expires: Date.now() + 60000, data };
      return data;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
/** Intentionally public, sanitized research display. No raw sources or athlete records leave the server. */
router.get(
  ["/research/ncaaf", "/research/ncaaf/data", "/research/ncaaf/download"],
  async (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    try {
      const data = await load();
      if (req.path.endsWith("/download")) {
        res.attachment("stadium-edge-ncaaf-research.json").json(data);
        return;
      }
      if (req.path.endsWith("/data")) {
        res.json(data);
        return;
      }
      res.type("html").send(renderNcaafResearchPreview(data));
    } catch {
      if (req.path === "/research/ncaaf")
        res
          .status(503)
          .type("html")
          .send(
            '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Research temporarily unavailable</title><h1>Research preview temporarily unavailable</h1><p>No forecast data was changed. Please try again shortly.</p><a href="/api/research/ncaaf">Retry</a></html>',
          );
      else
        res.status(503).json({
          error: "research_preview_unavailable",
          researchOnly: true,
          coachEnabled: false,
        });
    }
  },
);
export default router;
