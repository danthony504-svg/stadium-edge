// Temporary Coach screen render diagnostics — trace blank-body conditions.

import type { ParlayBuildPhase } from "@/components/AnalysisProgress";

export const COACH_RENDER_LOG = "[coach-render]";

export type CoachRenderMessageSlice = {
  role: string;
  content?: string;
  picksCount?: number;
  parlayBuild?: boolean;
  hasCoachDetailNote?: boolean;
  hasLegNote?: boolean;
  hideBubble?: boolean;
};

export type CoachRenderSnapshot = {
  messageCount: number;
  lastRole?: string;
  lastContentLen: number;
  lastPicksCount: number;
  /** Picks that survive coerce + filterCoachDeliveredPicks at paint time. */
  lastDisplayPicksCount: number;
  lastHasScanManifest: boolean;
  streaming: boolean;
  buildFinishing: boolean;
  waiting: boolean;
  buildProgressExpired: boolean;
  parlayBuildPhase: ParlayBuildPhase | "idle";
  boardScanPartialLegs: number;
  showQuickPrompts: boolean;
  footerParlayProgress: boolean;
  hasUserTurn: boolean;
  isOrphanThread: boolean;
  renderBranch: string;
  blankReason?: string;
};

let mountLogged = false;

export function logCoachMounted(): void {
  if (mountLogged) return;
  mountLogged = true;
  console.log(`${COACH_RENDER_LOG} mounted`);
}

export function logCoachRenderSnapshot(snapshot: CoachRenderSnapshot): void {
  console.log(`${COACH_RENDER_LOG} state=messages:${snapshot.messageCount} streaming:${snapshot.streaming} buildFinishing:${snapshot.buildFinishing} waiting:${snapshot.waiting} phase:${snapshot.parlayBuildPhase}`);
  console.log(
    `${COACH_RENDER_LOG} progress=footer:${snapshot.footerParlayProgress} partialLegs:${snapshot.boardScanPartialLegs} expired:${snapshot.buildProgressExpired}`,
  );
  console.log(
    `${COACH_RENDER_LOG} flags=quickPrompts:${snapshot.showQuickPrompts} orphan:${snapshot.isOrphanThread} hasUser:${snapshot.hasUserTurn}`,
  );
  console.log(
    `${COACH_RENDER_LOG} picks=raw:${snapshot.lastPicksCount} display:${snapshot.lastDisplayPicksCount} manifest:${snapshot.lastHasScanManifest}`,
  );
  console.log(`${COACH_RENDER_LOG} render=${snapshot.renderBranch}`);
  if (snapshot.blankReason) {
    console.log(`${COACH_RENDER_LOG} blankBecause=${snapshot.blankReason}`);
  }
}

/** True when the scroll body would paint zero visible nodes (header/input excluded). */
export function coachScrollBodyWouldBeBlank(input: {
  messages: CoachRenderMessageSlice[];
  showQuickPrompts: boolean;
  footerParlayProgress: boolean;
  lastDisplayPicksCount: number;
  lastHasScanManifest: boolean;
  isWelcome: (m: CoachRenderMessageSlice) => boolean;
}): { blank: boolean; reason?: string } {
  const {
    messages,
    showQuickPrompts,
    footerParlayProgress,
    lastDisplayPicksCount,
    lastHasScanManifest,
    isWelcome,
  } = input;

  if (showQuickPrompts || footerParlayProgress) {
    return { blank: false };
  }

  const visible = messages.filter(
    (m) => !(isWelcome(m) && messages.some((x) => x.role === "user")),
  );
  if (!visible.length) {
    return {
      blank: true,
      reason: "no visible messages after welcome filter and quick prompts suppressed",
    };
  }

  const anyBubble = visible.some((m) => {
    if (m.hideBubble) return false;
    if (m.role === "user") return (m.content?.trim().length ?? 0) > 0;
    return (
      (m.content?.trim().length ?? 0) > 0 || m.hasLegNote || m.hasCoachDetailNote
    );
  });
  if (anyBubble) return { blank: false };

  if (lastDisplayPicksCount > 0 || lastHasScanManifest) {
    return { blank: false };
  }

  const last = visible[visible.length - 1]!;
  const rawPicks = last.picksCount ?? 0;
  if (rawPicks > 0 && lastDisplayPicksCount === 0) {
    return {
      blank: true,
      reason: `assistant has ${rawPicks} raw pick(s) but filterCoachDeliveredPicks/coerceCoachDisplayPicks rendered 0 — showTicketHeader=false, progress blocked by hasPicks guard`,
    };
  }

  return {
    blank: true,
    reason: "quick prompts suppressed and no message bubble, progress, picks, or manifest paints",
  };
}

/** Derive which UI branch should paint the scroll body. */
export function resolveCoachRenderBranch(input: {
  messages: CoachRenderMessageSlice[];
  streaming: boolean;
  buildFinishing: boolean;
  waiting: boolean;
  buildProgressExpired: boolean;
  parlayBuildPhase: ParlayBuildPhase | "idle";
  showQuickPrompts: boolean;
  footerParlayProgress: boolean;
  isOrphanThread: boolean;
  isWelcome: (m: CoachRenderMessageSlice) => boolean;
  isParlayAsk: (text: string) => boolean;
}): { branch: string; blankReason?: string } {
  const {
    messages,
    streaming,
    buildFinishing,
    waiting,
    buildProgressExpired,
    parlayBuildPhase,
    showQuickPrompts,
    footerParlayProgress,
    isOrphanThread,
    isWelcome,
    isParlayAsk,
  } = input;

  if (messages.length === 0) {
    return showQuickPrompts
      ? { branch: "QuickPrompts" }
      : {
          branch: "Blank",
          blankReason: "messages.length===0 but showQuickPrompts===false",
        };
  }

  if (footerParlayProgress) {
    return { branch: "ProgressCard.footer" };
  }

  const visible = messages.filter(
    (m) => !(isWelcome(m) && messages.some((x) => x.role === "user")),
  );

  if (!visible.length) {
    return showQuickPrompts
      ? { branch: "QuickPrompts" }
      : {
          branch: "Blank",
          blankReason: "welcome filtered out and no other visible messages",
        };
  }

  const last = visible[visible.length - 1]!;
  const lastIsAssistant = last.role === "assistant";
  const busy = streaming || buildFinishing || waiting;

  if (showQuickPrompts) {
    return { branch: visible.length === 1 && isWelcome(visible[0]!) ? "Welcome+QuickPrompts" : "Messages+QuickPrompts" };
  }

  if (!lastIsAssistant) {
    return busy
      ? {
          branch: "Blank",
          blankReason: `last message is user while busy (streaming:${streaming} buildFinishing:${buildFinishing} waiting:${waiting}) — no footer progress`,
        }
      : { branch: "Messages" };
  }

  const hasPicks = (last.picksCount ?? 0) > 0;
  const hasManifest = !!last.hasCoachDetailNote;
  const hasText = (last.content?.trim().length ?? 0) > 0;
  const parlayIntent = !!last.parlayBuild;

  if (hasPicks) {
    return { branch: "Results.rawPicksOnMessage" };
  }
  if (hasManifest) return { branch: "Results.manifestOnly" };

  const progressLikely =
    busy &&
    (parlayIntent ||
      parlayBuildPhase === "board-scan" ||
      parlayBuildPhase === "correlation" ||
      buildFinishing);

  if (progressLikely) {
    return { branch: "ProgressCard.message" };
  }

  if (hasText) {
    return { branch: "Messages.bubble" };
  }

  if (busy && !isOrphanThread) {
    return {
      branch: "Blank",
      blankReason:
        `busy assistant shell with no bubble/picks/progress — streaming:${streaming} buildFinishing:${buildFinishing} waiting:${waiting} parlayBuild:${parlayIntent} phase:${parlayBuildPhase} expired:${buildProgressExpired}`,
    };
  }

  if (isOrphanThread) {
    return {
      branch: "Blank",
      blankReason: "orphan thread — assistant has no visible content and quick prompts hidden",
    };
  }

  return {
    branch: "Blank",
    blankReason: "no visible message content and quick prompts suppressed",
  };
}
