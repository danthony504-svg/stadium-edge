import { pickLegFingerprint } from "./parlayReachCore.ts";

export type AssistantMessagePick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  player?: string;
  propLine?: string;
  simulationPending?: boolean;
  finalAiScore?: { grade?: string; simHit?: number | string | null } | null;
  scores?: { grade?: string } | null;
};

export type AssistantMessagePatchFields = {
  picks: AssistantMessagePick[];
  legNote?: string;
  coachDetailNote?: string;
  ticketLegTarget?: number;
  content?: string;
};

/** Stable signature for idempotent assistant message patches (progressive sim / scan). */
export function assistantMessagePatchSignature(fields: AssistantMessagePatchFields): string {
  const pickSig = fields.picks
    .map((p) => {
      const grade = p.finalAiScore?.grade ?? p.scores?.grade ?? "";
      const simHit = p.finalAiScore?.simHit ?? "";
      const pending = p.simulationPending ? "1" : "0";
      return `${pickLegFingerprint(p as never)}|${p.player ?? ""}|${p.propLine ?? ""}|${grade}|${simHit}|${pending}`;
    })
    .join(";");
  return JSON.stringify({
    picks: pickSig,
    legNote: fields.legNote?.trim() ?? "",
    coachDetailNote: fields.coachDetailNote?.trim() ?? "",
    ticketLegTarget: fields.ticketLegTarget ?? 0,
    content: fields.content ?? null,
  });
}

function findLastAssistantIndex<T extends { role: string }>(messages: T[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") return i;
  }
  return -1;
}

/** Patch the latest assistant bubble only when picks / notes actually changed. */
export function patchAssistantMessageIfChanged<
  T extends {
    role: string;
    picks?: AssistantMessagePick[];
    content?: string;
    legNote?: string;
    coachDetailNote?: string;
    ticketLegTarget?: number;
  },
>(setMessages: (fn: (prev: T[]) => T[]) => void, fields: AssistantMessagePatchFields): boolean {
  let changed = false;
  setMessages((prev) => {
    const idx = findLastAssistantIndex(prev);
    if (idx < 0) return prev;
    const existing = prev[idx]!;
    const nextFields: AssistantMessagePatchFields = {
      picks: fields.picks,
      legNote: fields.legNote !== undefined ? fields.legNote.trim() || undefined : existing.legNote,
      coachDetailNote:
        fields.coachDetailNote !== undefined
          ? fields.coachDetailNote.trim() || undefined
          : existing.coachDetailNote,
      ticketLegTarget:
        fields.ticketLegTarget !== undefined && fields.ticketLegTarget > 0
          ? fields.ticketLegTarget
          : existing.ticketLegTarget,
      content: fields.content !== undefined ? fields.content : existing.content,
    };
    if (
      assistantMessagePatchSignature(nextFields) ===
      assistantMessagePatchSignature({
        picks: existing.picks ?? [],
        legNote: existing.legNote,
        coachDetailNote: existing.coachDetailNote,
        ticketLegTarget: existing.ticketLegTarget,
        content: existing.content,
      })
    ) {
      return prev;
    }
    changed = true;
    const copy = [...prev];
    copy[idx] = {
      ...existing,
      picks: nextFields.picks,
      content: nextFields.content,
      legNote: nextFields.legNote,
      coachDetailNote: nextFields.coachDetailNote,
      ticketLegTarget: nextFields.ticketLegTarget,
    };
    return copy;
  });
  return changed;
}

/** Flash or refresh picks on the latest assistant reply (seeds cards during long builds). */
export function patchLastAssistantPicks<
  T extends {
    role: string;
    picks?: AssistantMessagePick[];
    content?: string;
    legNote?: string;
    coachDetailNote?: string;
    ticketLegTarget?: number;
  },
>(
  setMessages: (fn: (prev: T[]) => T[]) => void,
  picks: AssistantMessagePick[],
  legNote?: string,
): boolean {
  return patchAssistantMessageIfChanged(setMessages, {
    picks,
    ...(legNote !== undefined ? { legNote } : {}),
    content: picks.length > 0 ? "" : undefined,
  });
}
