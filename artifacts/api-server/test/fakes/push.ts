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
};

export function resetPush(): void {
  __push.calls = [];
  __push.invalidTokens = [];
}

export async function sendPush(
  messages: PushMessage[],
): Promise<{ sent: number; invalidTokens: string[] }> {
  __push.calls.push(messages);
  return { sent: messages.length, invalidTokens: __push.invalidTokens };
}
