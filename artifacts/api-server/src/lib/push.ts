import { logger } from "./logger";

// Expo Push delivery. We talk to Expo's public push service directly (no SDK
// dependency) — it accepts up to 100 messages per request. Every send is
// best-effort: a transport/HTTP error just means that batch wasn't delivered
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
): Promise<{ sent: number; invalidTokens: string[] }> {
  const invalidTokens: string[] = [];
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: "POST",
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
        continue;
      }
      const json = (await r.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      tickets.forEach((t, idx) => {
        if (t.status === "ok") {
          sent += 1;
        } else if (t.details?.error === "DeviceNotRegistered") {
          const tok = chunk[idx]?.to;
          if (tok) invalidTokens.push(tok);
        }
      });
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        "expo push send failed (best-effort)",
      );
    }
  }
  return { sent, invalidTokens };
}
