import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { fetchModelCalibration } from "../lib/modelCalibration.js";

const router: IRouter = Router();

router.use("/sports/model-calibration", rateLimit({ windowMs: 60_000, max: 60, name: "model-calibration" }));

/** Historical accuracy calibration by sport + market — powers confidence adjustments. */
router.get("/sports/model-calibration", async (_req, res): Promise<void> => {
  try {
    const data = await fetchModelCalibration();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
