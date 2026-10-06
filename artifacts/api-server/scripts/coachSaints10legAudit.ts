/**
 * One-shot audit: "10 leg Saints" funnel + note consistency.
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coachSaints10legAudit.ts
 */
import { writeFileSync } from "node:fs";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import { coachAskTeamScope } from "../../stadium-mobile/lib/coachAskTeamScope.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";

const HARD_MS = 300_000;

async function main() {
  console.error("API_BASE", API_BASE);
  const scope = coachAskTeamScope("10 leg Saints");
  console.error("teamScope", JSON.stringify(scope));

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: 10,
      askText: "10 leg Saints",
      priorUserTexts: [],
      signal: ac.signal,
    });
  } finally {
    clearTimeout(kill);
  }

  const diag =
    (result.scan?.failureDiagnostics as Record<string, unknown> | undefined) ??
    (result.failureDiagnostics as Record<string, unknown> | null) ??
    null;
  const picks = result.picks ?? [];
  const byGame = new Map<string, number>();
  for (const p of picks) {
    const g = p.game || "?";
    byGame.set(g, (byGame.get(g) ?? 0) + 1);
  }
  const roles = { main: 0, alt: 0, other: 0 };
  for (const p of picks) {
    const r = p.ticketRole ?? "other";
    if (r === "main") roles.main += 1;
    else if (r === "alt") roles.alt += 1;
    else roles.other += 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    ask: "10 leg Saints",
    teamScope: scope,
    funnel: {
      requested: 10,
      available: {
        oddsGameCount: diag?.oddsGameCount ?? null,
        gameEntryCount: diag?.gameEntryCount ?? null,
        propPoolSize: diag?.propPoolSize ?? null,
      },
      simulated: {
        gameSimsLoaded: diag?.gameSimsLoaded ?? null,
        gameLegsScored: diag?.gameLegsScored ?? null,
        propSimEvaluated: diag?.propSimEvaluated ?? null,
        propLegsScored: diag?.propLegsScored ?? null,
      },
      qualified: {
        scoredBeforeStage: diag?.scoredBeforeStage ?? null,
      },
      final: picks.length,
    },
    roles,
    byGame: [...byGame.entries()],
    note: result.note,
    noteHasStalePoolCopy: /main lines and .+ alt lines cleared/i.test(result.note || ""),
    noteHasHonestShortfall: /qualified picks were available, so no filler was added/i.test(
      result.note || "",
    ),
    ticket: picks.map((p) => ({
      game: p.game,
      market: p.market,
      pick: p.pick ?? p.player,
      ticketRole: p.ticketRole ?? null,
      isProp: !!p.isProp,
    })),
  };

  writeFileSync(
    "/opt/cursor/artifacts/coach-saints-10leg-audit.json",
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    "/workspace/artifacts/api-server/scripts/coach-saints-10leg-audit.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
