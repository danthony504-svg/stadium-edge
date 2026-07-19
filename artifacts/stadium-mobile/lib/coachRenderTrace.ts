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
};

export type CoachRenderSnapshot = {
  messageCount: number;
  lastRole?: string;
  lastContentLen: number;
  lastPicksCount: number;
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
  console.log(`${COACH_RENDER_LOG} render=${snapshot.renderBranch}`);
  if (snapshot.blankReason) {
    console.log(`${COACH_RENDER_LOG} blankBecause=${snapshot.blankReason}`);
  }
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

  if (hasPicks) return { branch: "Results" };
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
