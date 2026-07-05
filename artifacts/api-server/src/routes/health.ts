import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  isOpenAIConfigured,
  openAIProviderLabel,
  probeOpenAI,
  probeOpenAIChat,
} from "../lib/openaiConfig.js";

const router: IRouter = Router();

/** Bumped when simulator/roster endpoints change — verify script checks this. */
export const SIM_API_VERSION = 2;

router.get("/healthz", async (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  const configured = isOpenAIConfigured();
  const provider = openAIProviderLabel();
  const probe = configured ? await probeOpenAI() : null;
  const chatProbe = configured ? await probeOpenAIChat() : null;
  res.json({
    ...data,
    simApiVersion: SIM_API_VERSION,
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
