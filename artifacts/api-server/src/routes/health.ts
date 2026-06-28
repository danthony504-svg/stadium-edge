import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isOpenAIConfigured, openAIProviderLabel } from "../lib/openaiConfig.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    ai: {
      configured: isOpenAIConfigured(),
      provider: openAIProviderLabel(),
    },
  });
});

export default router;
