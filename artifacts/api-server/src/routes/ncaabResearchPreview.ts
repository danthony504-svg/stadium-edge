import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { ncaabPipelineReadiness } from "../lib/ncaabPipelineReadiness.js";

const router: IRouter = Router();

router.get("/research/ncaab/status", async (_req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });
  try {
    const client = await pool.connect();
    try {
      res.json(await ncaabPipelineReadiness(client));
    } finally {
      client.release();
    }
  } catch {
    res.status(503).json({
      error: "ncaab_research_status_unavailable",
      coachEnabled: false,
      releaseEligible: false,
      decision: "BLOCKED",
    });
  }
});

export default router;
