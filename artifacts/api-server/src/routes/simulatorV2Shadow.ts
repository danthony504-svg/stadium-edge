/**
 * Isolated Simulator V2 shadow routes.
 * - Never mounted into Coach board-scan / ticket seating.
 * - Default flags keep masterEnabled=false; even when enabled, responses are shadow-only.
 */

import { Router, type IRouter } from "express";
import {
  InMemoryShadowLedger,
  buildShadowCompareEntry,
  parseSimV2FlagsFromEnv,
  SIM_V2_ENGINE_ID,
  SIM_V2_PACKAGE_VERSION,
  SIM_V2_SCHEMA_VERSION,
} from "@workspace/simulator-v2";
import { getSimV2Flags } from "../lib/simulatorV2Bridge.js";

const router: IRouter = Router();
const ledger = new InMemoryShadowLedger();

router.get("/v2/simulate/health", (_req, res): void => {
  const flags = getSimV2Flags();
  res.json({
    engineId: SIM_V2_ENGINE_ID,
    schemaVersion: SIM_V2_SCHEMA_VERSION,
    packageVersion: SIM_V2_PACKAGE_VERSION,
    phase: "A",
    sportModels: [],
    flags: {
      masterEnabled: flags.masterEnabled,
      shadowOnly: flags.shadowOnly,
      serveEnabled: flags.serveEnabled,
      forceV1Rollback: flags.forceV1Rollback,
      acceptedFamilies: flags.acceptedFamilies,
    },
    note: "Phase A platform only — no production sport models; cannot influence Coach picks under default flags.",
  });
});

router.get("/v2/simulate/models", (_req, res): void => {
  res.json({
    schemaVersion: SIM_V2_SCHEMA_VERSION,
    models: [],
    message: "No sport models registered in Phase A. Fixture tensors are test-only.",
  });
});

/** Append a shadow comparison row (internal/diagnostics). */
router.post("/v2/shadow/compare", (req, res): void => {
  const flags = getSimV2Flags();
  if (!flags.masterEnabled) {
    res.status(503).json({
      error: "sim_v2_disabled",
      hint: "Set SIM_V2_ENABLED=true to enable shadow diagnostics (still cannot influence Coach).",
    });
    return;
  }
  if (!flags.shadowOnly && flags.serveEnabled) {
    // Refuse write path that looks like a serve configuration on the shadow endpoint.
    res.status(409).json({
      error: "shadow_endpoint_serve_forbidden",
      hint: "Use SIM_V2_FORCE_V1=true or keep SIM_V2_SHADOW_ONLY=true for this endpoint.",
    });
    return;
  }

  try {
    const body = req.body ?? {};
    const entry = buildShadowCompareEntry({
      entryId: String(body.entryId ?? `shadow-${Date.now()}`),
      sport: body.sport,
      eventId: String(body.eventId ?? ""),
      marketId: String(body.marketId ?? ""),
      family: body.family,
      providerMarketKey: String(body.providerMarketKey ?? ""),
      providerOddsAmerican:
        body.providerOddsAmerican == null ? null : Number(body.providerOddsAmerican),
      v1: {
        simHit: body.v1SimHit == null ? null : Number(body.v1SimHit),
        latencyMs: body.v1LatencyMs == null ? null : Number(body.v1LatencyMs),
      },
      v2: body.v2 ?? null,
      actualResult: body.actualResult ?? null,
      actualSettledAt: body.actualSettledAt ?? null,
    });
    ledger.append(entry);
    res.status(201).json({ ok: true, entry, influencedProduction: false });
  } catch (err) {
    res.status(400).json({
      error: "invalid_shadow_payload",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get("/v2/shadow/ledger", (_req, res): void => {
  const flags = parseSimV2FlagsFromEnv(process.env);
  if (!flags.masterEnabled) {
    res.status(503).json({ error: "sim_v2_disabled" });
    return;
  }
  res.json({
    shadowOnly: true,
    influencedProduction: false,
    count: ledger.list().length,
    entries: ledger.list(),
  });
});

export default router;
