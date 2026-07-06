// Automated validation for production AI Coach tickets — summary, cards, slip, metadata.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isGameLinePick } from "./gameSimScoring.ts";
import {
  assertProductionCoachTicketIntegrity,
  assertProductionCoachTicketIntegritySummary,
  buildCoachTicketDisplayNote,
  buildFrozenGameLineSummaryNote,
  frozenGameLineHeader,
  frozenLegSurfaceLabels,
  normGameLabel,
  parseFrozenSummaryGamePicks,
  textHasPlaceholderGameLineMetrics,
  FrozenGameLineConsistencyError,
} from "./frozenGameLineConsistency.ts";
import {
  assertGameLineProductionMetadataComplete,
  assertSub50GameLineQualificationExplained,
  explainGameLineQualification,
  GAME_LINE_MIN_SIM_PCT,
  type GameLineQualificationReason,
} from "./gameLineFrozenQual.ts";

export type CoachTicketValidationViolation = {
  code: string;
  message: string;
  gameId?: string;
};

export type Sub50GameLineAudit = {
  gameId: string;
  game: string;
  pick: string;
  simPct: number;
  edgePct: number;
  qualification: GameLineQualificationReason;
};

export type CoachTicketValidationResult = {
  ok: boolean;
  violations: CoachTicketValidationViolation[];
  sub50GameLines: Sub50GameLineAudit[];
  canonicalPicks: ParsedPick[];
  summary: string;
  ticketNote: string;
};

function violation(
  code: string,
  message: string,
  gameId?: string,
): CoachTicketValidationViolation {
  return { code, message, gameId };
}

/**
 * Validate a production AI Coach ticket — summary, cards, slip, metadata, and
 * sub-50% qualification audit. Returns structured violations instead of throwing.
 */
export function validateCoachTicket(
  picks: ParsedPick[],
  opts?: { contextNote?: string; gameLineSummary?: string },
): CoachTicketValidationResult {
  const violations: CoachTicketValidationViolation[] = [];
  const sub50GameLines: Sub50GameLineAudit[] = [];
  let canonical: ParsedPick[] = picks;
  let summary = "";
  let ticketNote = "";

  try {
    canonical = assertProductionCoachTicketIntegrity(picks, opts?.gameLineSummary);
  } catch (e) {
    violations.push(
      violation(
        "production_integrity",
        e instanceof Error ? e.message : String(e),
      ),
    );
    return { ok: false, violations, sub50GameLines, canonicalPicks: canonical, summary, ticketNote };
  }

  const gameLinePicks = canonical.filter((p) => isGameLinePick(p) && !p.isProp);
  if (!gameLinePicks.length) {
    return { ok: violations.length === 0, violations, sub50GameLines, canonicalPicks: canonical, summary, ticketNote };
  }

  try {
    summary = buildFrozenGameLineSummaryNote(canonical);
    ticketNote = buildCoachTicketDisplayNote(canonical, opts?.contextNote);
  } catch (e) {
    violations.push(
      violation("summary_build", e instanceof Error ? e.message : String(e)),
    );
    return { ok: false, violations, sub50GameLines, canonicalPicks: canonical, summary, ticketNote };
  }

  if (textHasPlaceholderGameLineMetrics(summary) || textHasPlaceholderGameLineMetrics(ticketNote)) {
    violations.push(
      violation("placeholder_metrics", "Ticket note or summary contains placeholder Final AI or Edge dashes"),
    );
  }

  try {
    assertProductionCoachTicketIntegritySummary(canonical, summary);
  } catch (e) {
    violations.push(
      violation(
        "summary_card_alignment",
        e instanceof Error ? e.message : String(e),
      ),
    );
  }

  const summaryPicks = parseFrozenSummaryGamePicks(summary);
  const seenGames = new Set<string>();

  for (const pick of gameLinePicks) {
    const header = frozenGameLineHeader(pick);
    const gameId = normGameLabel(header.game);

    try {
      assertGameLineProductionMetadataComplete(pick);
    } catch (e) {
      violations.push(
        violation(
          "incomplete_metadata",
          e instanceof Error ? e.message : String(e),
          gameId,
        ),
      );
      continue;
    }

    const d = pick.gameLineFinal!.display!;
    if (!d.grade?.trim() || d.confidencePct == null || d.edgePct == null || d.simHit == null) {
      violations.push(
        violation(
          "incomplete_metadata",
          `Game line ${header.pick} (${header.game}) missing AI Grade, Confidence, Edge, or Simulation`,
          gameId,
        ),
      );
    }

    if (seenGames.has(gameId)) {
      violations.push(
        violation(
          "duplicate_game",
          `Duplicate game-line leg on ${header.game}`,
          gameId,
        ),
      );
    }
    seenGames.add(gameId);

    const surfaces = frozenLegSurfaceLabels(pick);
    if (surfaces.card !== surfaces.slip) {
      violations.push(
        violation(
          "card_slip_mismatch",
          `Card and slip disagree on ${header.game}: card="${surfaces.card}" slip="${surfaces.slip}"`,
          gameId,
        ),
      );
    }
    if (surfaces.card !== surfaces.breakdown || surfaces.card !== surfaces.share) {
      violations.push(
        violation(
          "surface_mismatch",
          `Card/breakdown/share disagree on ${header.game}`,
          gameId,
        ),
      );
    }

    const summaryPick = summaryPicks.get(gameId);
    if (!summaryPick) {
      violations.push(
        violation(
          "summary_missing_leg",
          `Summary missing game line ${header.pick} (${header.game})`,
          gameId,
        ),
      );
    } else if (
      summaryPick !== header.pick.toLowerCase().replace(/\s+/g, " ").trim()
    ) {
      violations.push(
        violation(
          "summary_card_pick_mismatch",
          `Summary pick "${summaryPick}" does not match card "${header.pick}" on ${header.game}`,
          gameId,
        ),
      );
    }

    try {
      const qualification = explainGameLineQualification(pick);
      if (qualification.simPct < GAME_LINE_MIN_SIM_PCT) {
        sub50GameLines.push({
          gameId,
          game: header.game,
          pick: header.pick,
          simPct: qualification.simPct,
          edgePct: qualification.edgePct,
          qualification,
        });
        assertSub50GameLineQualificationExplained(pick);
      }
    } catch (e) {
      violations.push(
        violation(
          "qualification_unexplained",
          e instanceof Error ? e.message : String(e),
          gameId,
        ),
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    sub50GameLines,
    canonicalPicks: canonical,
    summary,
    ticketNote,
  };
}

/** Hard-fail when any Coach ticket validation check fails. */
export function assertCoachTicketValidation(
  picks: ParsedPick[],
  opts?: { contextNote?: string; gameLineSummary?: string },
): CoachTicketValidationResult {
  const result = validateCoachTicket(picks, opts);
  if (!result.ok) {
    const first = result.violations[0]!;
    throw new FrozenGameLineConsistencyError(
      `Coach ticket validation failed [${first.code}]: ${first.message}`,
    );
  }
  return result;
}
