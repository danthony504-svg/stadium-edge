import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  isOpenAIConfigured,
  openAIProviderLabel,
  probeOpenAI,
  probeOpenAIChat,
} from "../lib/openaiConfig.js";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  const configured = isOpenAIConfigured();
  const provider = openAIProviderLabel();
  const probe = configured ? await probeOpenAI() : null;
  const chatProbe = configured ? await probeOpenAIChat() : null;
  res.json({
    ...data,
    ai: {
      configured,
      provider,
      ok: probe?.ok ?? false,
      model: probe?.model ?? null,
      ...(probe && !probe.ok
        ? { error: probe.message, code: probe.code ?? null }
        : {}),
      chat: chatProbe
        ? {
            ok: chatProbe.ok,
            ...(chatProbe.ok
              ? {}
              : { error: chatProbe.message, code: chatProbe.code ?? null }),
          }
        : null,
    },
  });
});

export default router;
