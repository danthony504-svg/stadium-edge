import { logger } from "./logger";

// Expo Push delivery. We talk to Expo's public push service directly (no SDK
// dependency) — it accepts up to 100 messages per request. Every send is
// best-effort: a transport/HTTP error just means that batch wasn't delivered
// (we never throw, so one bad chunk can't abort a whole notification run).
//
// Expo replies with a per-message ticket; tickets whose error is
// "DeviceNotRegistered" mean the app was uninstalled / the token is dead, so we
// surface those tokens to the caller to prune from the database.
//
// Successful tickets are also queued for an async receipt check (off the request
// path). Receipts can report DeviceNotRegistered after APNs accepts the ticket.

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PendingExpoReceipt = {
  ticketId: string;
  token: string;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

/** Expo docs: wait ~15s after ticket before receipts are available. */
const RECEIPT_DELAY_MS = 15_000;

type ExpoTicket = {
  status: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoReceipt = {
  status: string;
  message?: string;
  details?: { error?: string };
};

export async function sendPush(
  messages: PushMessage[],
): Promise<{
  sent: number;
  invalidTokens: string[];
  pendingReceipts: PendingExpoReceipt[];
}> {
  const invalidTokens: string[] = [];
  const pendingReceipts: PendingExpoReceipt[] = [];
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
        const tok = chunk[idx]?.to;
        if (t.status === "ok") {
          sent += 1;
          if (t.id && tok) pendingReceipts.push({ ticketId: t.id, token: tok });
        } else if (t.details?.error === "DeviceNotRegistered") {
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
  return { sent, invalidTokens, pendingReceipts };
}

/**
 * Query Expo push receipts for prior successful tickets. Returns tokens that
 * receipts mark as DeviceNotRegistered (safe to prune). Never throws.
 */
export async function fetchExpoInvalidTokensFromReceipts(
  pending: PendingExpoReceipt[],
): Promise<string[]> {
  const invalid: string[] = [];
  if (!pending.length) return invalid;
  const byId = new Map(pending.map((p) => [p.ticketId, p.token]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    try {
      const r = await fetch(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ ids: batch }),
      });
      if (!r.ok) {
        logger.warn({ status: r.status }, "expo push receipts non-2xx");
        continue;
      }
      const json = (await r.json()) as { data?: Record<string, ExpoReceipt> };
      const data = json.data ?? {};
      for (const id of batch) {
        const receipt = data[id];
        if (!receipt) continue;
        if (
          receipt.status === "error" &&
          receipt.details?.error === "DeviceNotRegistered"
        ) {
          const tok = byId.get(id);
          if (tok) invalid.push(tok);
        }
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        "expo push receipts failed (best-effort)",
      );
    }
  }
  return invalid;
}

/**
 * Fire-and-forget receipt poll. Does NOT block the caller (test notification
 * response, cron job). `onInvalidTokens` should prune DB rows.
 */
export function scheduleExpoReceiptCheck(
  pending: PendingExpoReceipt[],
  onInvalidTokens: (tokens: string[]) => void | Promise<void>,
): void {
  if (!pending.length) return;
  const snapshot = pending.map((p) => ({ ...p }));
  setTimeout(() => {
    void (async () => {
      try {
        const invalid = await fetchExpoInvalidTokensFromReceipts(snapshot);
        if (invalid.length) await onInvalidTokens(invalid);
      } catch (err) {
        logger.warn(
          { err: (err as Error)?.message },
          "expo receipt prune callback failed",
        );
      }
    })();
  }, RECEIPT_DELAY_MS);
}
