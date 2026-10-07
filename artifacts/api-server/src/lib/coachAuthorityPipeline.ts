/**
 * Production path for Coach current-fact authority (all sports).
 *
 * Mirrors the /chat wiring: roster grounding → TPM trim → currentFactGrounding
 * → context block + authority addenda. Tests call this same function so
 * payload proofs cannot drift from chat.ts.
 */

import type { OpenAIProvider } from "./openaiConfig.js";
import {
  CURRENT_FACT_AUTHORITY_RULE,
  buildCurrentFactGroundingPayload,
} from "./currentFactAuthority.js";
import {
  buildRosterGrounding,
  extractNamedPlayers,
  ROSTER_GROUNDING_SYSTEM_RULE,
  wantsRosterGrounding,
} from "./rosterGrounding.js";
import { trimLockedContextForDirectOpenAI } from "./coachSystemPrompt.js";

export type CoachAuthorityPipelineResult = {
  lockedContext: Record<string, unknown>;
  contextBlock: string;
  /** Always present — appended to the final system message every turn. */
  currentFactAuthorityAddendum: string;
  /** Present when wantsRosterGrounding(userText). */
  rosterGroundingAddendum: string;
  /** Full system-tail fragment after the base SYSTEM_PROMPT (context + rules). */
  systemTail: string;
};

/**
 * Attach roster + current-fact authority to a Coach turn context.
 * Same sequence as artifacts/api-server/src/routes/chat.ts.
 */
export async function attachCoachAuthorityContext(args: {
  latestUser: string;
  lockedContext: Record<string, unknown> | null | undefined;
  /** Fallback props when lockedContext.realProps is empty (e.g. pre-filter). */
  clientContext?: Record<string, unknown> | null;
  provider: OpenAIProvider;
  namedGameLabels?: Set<string>;
  now?: Date;
  fetchPlayer?: Parameters<typeof buildRosterGrounding>[1] extends
    | { fetchPlayer?: infer F }
    | undefined
    ? F
    : never;
}): Promise<CoachAuthorityPipelineResult> {
  let lockedContext: Record<string, unknown> = {
    ...((args.lockedContext && typeof args.lockedContext === "object"
      ? args.lockedContext
      : {}) as Record<string, unknown>),
  };

  try {
    if (wantsRosterGrounding(args.latestUser)) {
      const ctxProps = Array.isArray(lockedContext.realProps)
        ? (lockedContext.realProps as Array<Record<string, unknown>>)
        : Array.isArray(args.clientContext?.realProps)
          ? (args.clientContext!.realProps as Array<Record<string, unknown>>)
          : [];
      const rosterGrounding = await buildRosterGrounding(args.latestUser, {
        realProps: ctxProps,
        now: args.now,
        fetchPlayer: args.fetchPlayer,
      });
      if (rosterGrounding) {
        lockedContext = {
          ...lockedContext,
          rosterGrounding,
          asOf: rosterGrounding.retrievedAt,
          seasonYear: rosterGrounding.seasonYear,
        };
      }
    }
  } catch {
    // best-effort
  }

  if (args.provider === "openai" && Object.keys(lockedContext).length > 0) {
    lockedContext =
      trimLockedContextForDirectOpenAI(lockedContext, {
        namedGameLabels: args.namedGameLabels,
      }) ?? lockedContext;
  }

  try {
    const currentFactGrounding = buildCurrentFactGroundingPayload({
      rosterGrounding:
        (lockedContext.rosterGrounding as Record<string, unknown> | null | undefined) ??
        null,
      liveContext: lockedContext as Parameters<
        typeof buildCurrentFactGroundingPayload
      >[0]["liveContext"],
      namedPlayers: extractNamedPlayers(args.latestUser),
      now: args.now,
    });
    lockedContext = {
      ...lockedContext,
      currentFactGrounding,
    };
  } catch {
    // best-effort
  }

  const contextBlock =
    Object.keys(lockedContext).length > 0
      ? `\n\nCurrent app context:\n${
          args.provider === "openai"
            ? JSON.stringify(lockedContext)
            : JSON.stringify(lockedContext, null, 2)
        }`
      : "";

  const currentFactAuthorityAddendum = `\n\n${CURRENT_FACT_AUTHORITY_RULE}`;
  const rosterGroundingAddendum = wantsRosterGrounding(args.latestUser)
    ? `\n\n${ROSTER_GROUNDING_SYSTEM_RULE}`
    : "";

  return {
    lockedContext,
    contextBlock,
    currentFactAuthorityAddendum,
    rosterGroundingAddendum,
    systemTail: contextBlock + currentFactAuthorityAddendum + rosterGroundingAddendum,
  };
}
