/**
 * Client helper for the App Review–only verification path.
 *
 * Sends email + verification code to the API. The server validates against
 * APP_REVIEW_EMAIL / APP_REVIEW_CODE and returns a Clerk sign-in ticket.
 * No secrets are embedded in this bundle.
 */

import { fetch as expoFetch } from "expo/fetch";

import { API_BASE } from "./apiBase";

export type AppReviewTicketResult =
  | { ok: true; ticket: string }
  | { ok: false; reason: "unavailable" | "rejected" | "network" };

export async function requestAppReviewTicket(
  email: string,
  code: string,
): Promise<AppReviewTicketResult> {
  const trimmedEmail = email.trim();
  const trimmedCode = code.trim();
  if (!trimmedEmail || !trimmedCode) return { ok: false, reason: "rejected" };

  try {
    const res = (await expoFetch(`${API_BASE}/auth/app-review-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmedEmail, code: trimmedCode }),
    })) as unknown as Response;

    if (res.status === 404) return { ok: false, reason: "unavailable" };
    if (!res.ok) return { ok: false, reason: "rejected" };

    const json = (await res.json()) as { ok?: boolean; ticket?: string };
    if (json?.ok && typeof json.ticket === "string" && json.ticket.length > 0) {
      return { ok: true, ticket: json.ticket };
    }
    return { ok: false, reason: "rejected" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
