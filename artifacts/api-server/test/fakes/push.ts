// Test stub for ./push.js. Records the messages handed to sendPush so a test can
// assert exactly when (and how many times) a push fired, and lets a test inject
// invalid tokens to exercise the dead-token prune path.
type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export const __push = {
  calls: [] as PushMessage[][],
  invalidTokens: [] as string[],
  pendingReceipts: [] as { ticketId: string; token: string }[],
  scheduledReceiptChecks: 0,
};

export function resetPush(): void {
  __push.calls = [];
  __push.invalidTokens = [];
  __push.pendingReceipts = [];
  __push.scheduledReceiptChecks = 0;
}

export async function sendPush(
  messages: PushMessage[],
): Promise<{
  sent: number;
  invalidTokens: string[];
  pendingReceipts: { ticketId: string; token: string }[];
}> {
  __push.calls.push(messages);
  return {
    sent: messages.length,
    invalidTokens: __push.invalidTokens,
    pendingReceipts: __push.pendingReceipts,
  };
}

export function scheduleExpoReceiptCheck(
  pending: { ticketId: string; token: string }[],
  _onInvalidTokens: (tokens: string[]) => void | Promise<void>,
): void {
  if (pending.length) __push.scheduledReceiptChecks += 1;
}
