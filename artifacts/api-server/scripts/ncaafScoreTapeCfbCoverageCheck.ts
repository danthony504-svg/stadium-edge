/**
 * Verify ScoreTape CFB injury timestamp coverage under Explorer key.
 * Never prints the API key. Does not purchase. Does not activate Desk.
 *
 *   node --import ./test/register-hooks.mjs ./scripts/ncaafScoreTapeCfbCoverageCheck.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCfbCoverageBlockedReport,
  evaluateCfbInjuryRows,
  scoreTapeKeyConfigured,
  scoreTapeKeyPresence,
  SCORETAPE_EXPLORER_SETUP,
  SCORETAPE_SECURE_SETUP_STEPS,
} from "../src/lib/sportSim/ncaafClean/scoreTapeExplorerSetup.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const ART = "/opt/cursor/artifacts";

async function main(): Promise<number> {
  const keySet = scoreTapeKeyConfigured();
  if (!keySet) {
    const report = buildCfbCoverageBlockedReport({ keyConfigured: false });
    const out = {
      ...report,
      plan: SCORETAPE_EXPLORER_SETUP,
      keyPresence: scoreTapeKeyPresence(),
      secureSetupInstructions: SCORETAPE_SECURE_SETUP_STEPS,
      verdict: "NOT_USABLE_EVIDENCE — key unset",
    };
    writeFileSync(
      join(FIX, "ncaaf-scoretape-cfb-coverage.json"),
      `${JSON.stringify(out, null, 2)}\n`,
    );
    try {
      mkdirSync(ART, { recursive: true });
      writeFileSync(
        join(ART, "ncaaf-scoretape-cfb-coverage.json"),
        `${JSON.stringify(out, null, 2)}\n`,
      );
    } catch {
      /* ignore */
    }
    console.log(JSON.stringify({ ok: true, ...out, secureSetupInstructions: undefined }, null, 2));
    console.log("\n--- Secure setup (ScoreTape Explorer $0) ---");
    for (const step of SCORETAPE_SECURE_SETUP_STEPS) console.log(`• ${step}`);
    return 0;
  }

  const key = String(process.env.SCORETAPE_API_KEY).trim();
  const since = new Date(Date.now() - 6 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const url = `${SCORETAPE_EXPLORER_SETUP.baseUrl}/cfb/injuries?since=${since}`;
  let httpStatus: number | null = null;
  try {
    const res = await fetch(url, {
      headers: {
        "X-API-Key": key,
        "User-Agent": "stadium-edge-scoretape-cfb-check/1.0",
      },
    });
    httpStatus = res.status;
    if (!res.ok) {
      const report = buildCfbCoverageBlockedReport({
        keyConfigured: true,
        httpStatus,
        message: `CFB injuries HTTP ${res.status}`,
      });
      const out = {
        ...report,
        keyPresence: "SET" as const,
        verdict: "NOT_USABLE_EVIDENCE — HTTP error",
      };
      writeFileSync(
        join(FIX, "ncaaf-scoretape-cfb-coverage.json"),
        `${JSON.stringify(out, null, 2)}\n`,
      );
      console.log(JSON.stringify(out, null, 2));
      return 2;
    }
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(body.data) ? body.data : [];
    const evaled = evaluateCfbInjuryRows(rows);
    const out = {
      checkedAt: new Date().toISOString(),
      keyConfigured: true,
      keyPresence: "SET" as const,
      cfbUsableEvidence: evaled.cfbUsableEvidence,
      httpStatus,
      rowCount: rows.length,
      ...evaled,
      since,
      blockers: evaled.cfbUsableEvidence
        ? []
        : ["CFB response had no finite captured_ms/captured timestamps"],
      verdict: evaled.cfbUsableEvidence
        ? "CFB_USABLE_FOR_EXPLORER_WINDOW — not a Desk historical proof"
        : "NOT_USABLE_EVIDENCE — no timestamps",
      secureSetup: SCORETAPE_SECURE_SETUP_STEPS,
    };
    writeFileSync(
      join(FIX, "ncaaf-scoretape-cfb-coverage.json"),
      `${JSON.stringify(out, null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          keyPresence: "SET",
          cfbUsableEvidence: out.cfbUsableEvidence,
          rowCount: out.rowCount,
          rowsWithTimestamp: out.rowsWithTimestamp,
          earliestCapturedIso: out.earliestCapturedIso,
          latestCapturedIso: out.latestCapturedIso,
          verdict: out.verdict,
        },
        null,
        2,
      ),
    );
    return evaled.cfbUsableEvidence ? 0 : 3;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const report = buildCfbCoverageBlockedReport({
      keyConfigured: true,
      httpStatus,
      message,
    });
    writeFileSync(
      join(FIX, "ncaaf-scoretape-cfb-coverage.json"),
      `${JSON.stringify({ ...report, keyPresence: "SET", verdict: "NOT_USABLE_EVIDENCE — fetch error" }, null, 2)}\n`,
    );
    console.error(JSON.stringify({ ok: false, message }, null, 2));
    return 2;
  }
}

main().then((c) => process.exit(c));
