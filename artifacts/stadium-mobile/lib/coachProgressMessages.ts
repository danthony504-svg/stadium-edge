import {
  coachProgressSignature,
  initialCoachProgress,
  logCoachProgress,
  mergeCoachProgress,
  type CoachCanonicalProgress,
  type CoachProgressPatch,
} from "./coachProgressState.ts";

export type CoachProgressMessage = {
  role: string;
  requestId?: string;
  coachProgress?: CoachCanonicalProgress;
  parlayBuild?: boolean;
  picks?: unknown[];
  content?: string;
};

export function findCoachProgressMessageIndex<T extends CoachProgressMessage>(
  messages: T[],
  requestId: string,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.requestId === requestId || m.coachProgress?.requestId === requestId) {
      return i;
    }
  }
  return -1;
}

function findAttachIndex<T extends CoachProgressMessage>(messages: T[], requestId: string): number {
  const exact = findCoachProgressMessageIndex(messages, requestId);
  if (exact >= 0) return exact;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if (m.picks?.length) continue;
    if (m.parlayBuild || m.content === "") return i;
  }
  return -1;
}

export function upsertCoachProgressMessage<T extends CoachProgressMessage>(
  messages: T[],
  patch: CoachProgressPatch,
): T[] {
  const idx = findAttachIndex(messages, patch.requestId);
  if (idx < 0) return messages;

  const current = messages[idx].coachProgress;
  const merged = mergeCoachProgress(current, patch);
  if (!merged) return messages;

  if (current && coachProgressSignature(current) === coachProgressSignature(merged)) {
    return messages;
  }

  const copy = [...messages];
  copy[idx] = {
    ...copy[idx],
    requestId: patch.requestId,
    coachProgress: merged,
  };
  logCoachProgress("updated-existing", {
    requestId: patch.requestId,
    stage: merged.stage,
    percent: merged.percent,
  });
  return copy;
}

/** Remove duplicate progress cards for the same requestId, keeping the highest rank. */
export function dedupeCoachProgressMessages<T extends CoachProgressMessage>(messages: T[]): T[] {
  const bestByRequest = new Map<string, CoachCanonicalProgress>();
  const indicesByRequest = new Map<string, number[]>();

  messages.forEach((m, i) => {
    const requestId = m.coachProgress?.requestId ?? m.requestId;
    if (!requestId || !m.coachProgress) return;
    const list = indicesByRequest.get(requestId) ?? [];
    list.push(i);
    indicesByRequest.set(requestId, list);
    const prev = bestByRequest.get(requestId);
    if (!prev || coachProgressSignature(m.coachProgress) !== coachProgressSignature(prev)) {
      bestByRequest.set(requestId, m.coachProgress);
    }
  });

  let changed = false;
  const next = [...messages];
  for (const [requestId, indices] of indicesByRequest) {
    if (indices.length <= 1) continue;
    const keep = indices[0]!;
    const merged = bestByRequest.get(requestId) ?? initialCoachProgress(requestId);
    next[keep] = {
      ...next[keep],
      requestId,
      coachProgress: merged,
    };
    for (let j = 1; j < indices.length; j++) {
      const dropIdx = indices[j]!;
      const dropped = next[dropIdx];
      if (!dropped?.coachProgress) continue;
      next[dropIdx] = {
        ...dropped,
        coachProgress: undefined,
      };
      changed = true;
      logCoachProgress("duplicate-removed", { requestId, index: dropIdx });
    }
  }
  return changed ? next : messages;
}

export function lockCoachProgressTerminal<T extends CoachProgressMessage>(
  messages: T[],
  requestId: string,
): T[] {
  const idx = findCoachProgressMessageIndex(messages, requestId);
  if (idx < 0) return messages;
  const merged = mergeCoachProgress(messages[idx].coachProgress, {
    requestId,
    stage: "complete",
    percent: 100,
    terminal: true,
    propsComplete: true,
    edgeComplete: true,
    simulationsComplete: true,
    ticketComplete: true,
  });
  if (!merged) return messages;
  const copy = [...messages];
  copy[idx] = { ...copy[idx], coachProgress: merged };
  return copy;
}
