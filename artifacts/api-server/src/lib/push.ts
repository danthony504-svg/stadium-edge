import { logger } from "./logger";

// Expo Push delivery. We talk to Expo's public push service directly (no SDK
// dependency) — it accepts up to 100 messages per request. Every send is
// best-effort: a transport error leaves acceptance unknown
// (we never throw, so one bad chunk can't abort a whole notification run).
//
// Expo replies with a per-message ticket; tickets whose error is
// "DeviceNotRegistered" mean the app was uninstalled / the token is dead, so we
// surface those tokens to the caller to prune from the database.

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type ExpoTicket = {
  status: string;
  message?: string;
  details?: { error?: string };
};

export async function sendPush(
  messages: PushMessage[],
): Promise<{
  sent: number;
  invalidTokens: string[];
  accepted: number[];
  rejected: number[];
  unknown: number[];
}> {
  const invalidTokens: string[] = [];
  let sent = 0;
  const accepted: number[] = [],
    rejected: number[] = [],
    unknown: number[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data ?? {},
            sound: "default",
            priority: "high",
          })),
        ),
      });
      if (!r.ok) {
        logger.warn({ status: r.status }, "expo push send non-2xx");
        for (let j = 0; j < chunk.length; j++)
          (r.status === 429 || r.status === 400 ? rejected : unknown).push(
            i + j,
          );
        continue;
      }
      const json = (await r.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      for (let idx = 0; idx < chunk.length; idx++) {
        const t = tickets[idx];
        if (!t) {
          unknown.push(i + idx);
          continue;
        }
        if (t.status === "ok") {
          sent += 1;
          accepted.push(i + idx);
        } else if (t.details?.error === "DeviceNotRegistered") {
          rejected.push(i + idx);
          const tok = chunk[idx]?.to;
          if (tok) invalidTokens.push(tok);
        } else {
          rejected.push(i + idx);
        }
      }
    } catch (err) {
      for (let j = 0; j < chunk.length; j++) unknown.push(i + j);
      logger.warn(
        { err: (err as Error)?.message },
        "expo push send failed (best-effort)",
      );
    }
  }
  return { sent, invalidTokens, accepted, rejected, unknown };
}
