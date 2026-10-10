import { Router, type IRouter } from "express";
import { buildAppConfigPayload } from "../lib/minAppVersion.js";

const router: IRouter = Router();

/** Public — outdated clients must be able to read the minimum version. */
router.get("/app/config", (_req, res) => {
  res.json({ ok: true, ...buildAppConfigPayload() });
});

export default router;
