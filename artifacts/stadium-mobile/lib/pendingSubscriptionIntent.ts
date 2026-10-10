/**
 * Persist Plans → Sign In return state.
 *
 * Never auto-starts StoreKit after auth — only restores the selected plan
 * (or restore intent) on /plans so the user must tap Subscribe / Restore again.
 */

import type { PlanId } from "./entitlements";

export const PENDING_SUBSCRIPTION_INTENT_KEY =
  "stadium-edge:pending-subscription-intent:v1";

export type PaidPlanId = Extract<PlanId, "go" | "pro">;

export type SubscriptionIntent =
  | { intent: "purchase"; planId: PaidPlanId }
  | { intent: "restore"; planId?: PaidPlanId };

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return value === "go" || value === "pro";
}

export function parseSubscriptionIntent(raw: unknown): SubscriptionIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.intent === "restore") {
    const planId = isPaidPlanId(obj.planId) ? obj.planId : undefined;
    return planId ? { intent: "restore", planId } : { intent: "restore" };
  }
  if (obj.intent === "purchase" && isPaidPlanId(obj.planId)) {
    return { intent: "purchase", planId: obj.planId };
  }
  return null;
}

export function parseSubscriptionIntentJson(
  json: string | null | undefined,
): SubscriptionIntent | null {
  if (!json || !json.trim()) return null;
  try {
    return parseSubscriptionIntent(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Href to open Clerk sign-in while preserving Plans return + plan selection. */
export function signInHrefForSubscriptionIntent(
  intent: SubscriptionIntent,
): string {
  const params = new URLSearchParams();
  params.set("returnTo", "plans");
  if (intent.intent === "purchase") {
    params.set("plan", intent.planId);
    params.set("intent", "purchase");
  } else {
    params.set("intent", "restore");
    if (intent.planId) params.set("plan", intent.planId);
  }
  return `/sign-in?${params.toString()}`;
}

/** Href back to Plans after auth — selection only, never auto-purchase. */
export function plansHrefForSubscriptionIntent(
  intent: SubscriptionIntent | null,
): string {
  if (!intent) return "/plans";
  const params = new URLSearchParams();
  if (intent.intent === "purchase") {
    params.set("plan", intent.planId);
  } else {
    params.set("intent", "restore");
    if (intent.planId) params.set("plan", intent.planId);
  }
  const q = params.toString();
  return q ? `/plans?${q}` : "/plans";
}

/**
 * Resolve post-auth navigation target.
 * Prefers URL params (returnTo=plans); merges stored plan when URL omits it.
 */
export function resolvePostAuthHref(opts: {
  returnTo?: string | null;
  plan?: string | null;
  intent?: string | null;
  stored?: SubscriptionIntent | null;
}): string {
  const returnTo = (opts.returnTo ?? "").trim().toLowerCase();
  if (returnTo === "plans" || returnTo === "/plans") {
    const intentKind =
      opts.intent === "restore" || opts.stored?.intent === "restore"
        ? "restore"
        : "purchase";
    const planId =
      (isPaidPlanId(opts.plan) ? opts.plan : undefined) ??
      (opts.stored && isPaidPlanId(opts.stored.planId) ? opts.stored.planId : undefined);
    const fromParams = parseSubscriptionIntent({
      intent: intentKind,
      planId,
    });
    if (fromParams) return plansHrefForSubscriptionIntent(fromParams);
    if (opts.stored) return plansHrefForSubscriptionIntent(opts.stored);
    return "/plans";
  }
  // Unrelated sign-in (no returnTo=plans) always goes home — do not hijack
  // with a stale Plans intent left after a cancelled subscribe attempt.
  return "/";
}

/** Draft Go/Pro selection for Plans UI — never triggers StoreKit. */
export function draftPlanFromReturnParams(opts: {
  plan?: string | null;
  intent?: string | null;
  stored?: SubscriptionIntent | null;
  fallback?: PaidPlanId;
}): PaidPlanId {
  if (isPaidPlanId(opts.plan)) return opts.plan;
  if (opts.stored?.planId && isPaidPlanId(opts.stored.planId)) {
    return opts.stored.planId;
  }
  return opts.fallback === "pro" ? "pro" : "go";
}

export function signUpHrefPreservingReturn(signInSearch: string): string {
  const q = signInSearch.startsWith("?")
    ? signInSearch.slice(1)
    : signInSearch.replace(/^\//, "");
  // Accept raw query or full path query.
  const query = q.includes("returnTo=")
    ? q
    : q.startsWith("sign-in?")
      ? q.slice("sign-in?".length)
      : q;
  return query ? `/sign-up?${query}` : "/sign-up";
}
