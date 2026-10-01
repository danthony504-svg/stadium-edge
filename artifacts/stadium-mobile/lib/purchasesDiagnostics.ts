/**
 * Pure RevenueCat / StoreKit diagnostic helpers (Node-testable).
 * Never accept or return full API keys, receipts, or Apple account data.
 */

/** Classify RevenueCat public SDK key without exposing the secret. */
export function revenueCatKeyPrefixType(apiKey: string): "appl_" | "test_" | "other" | "missing" {
  const key = apiKey.trim();
  if (!key) return "missing";
  if (key.startsWith("appl_")) return "appl_";
  if (key.startsWith("test_")) return "test_";
  return "other";
}

/** Short alert body for product-resolution failures (screenshot-friendly). */
export function rcDiagnosticAlert(detail: string): string {
  const trimmed = detail.trim().replace(/\s+/g, " ");
  const clipped = trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
  if (clipped.startsWith("RC diagnostic:")) return clipped;
  return `RC diagnostic: ${clipped}`;
}

/**
 * Serialize a RevenueCat / StoreKit error for logs + short UI without secrets.
 */
export function describePurchasesError(err: unknown): {
  code: string;
  message: string;
  underlying: string | null;
  serialized: string;
  short: string;
} {
  let code = "unknown";
  let message = "Unknown error";
  let underlying: string | null = null;

  if (err && typeof err === "object") {
    const e = err as {
      code?: unknown;
      message?: unknown;
      underlyingErrorMessage?: unknown;
      userInfo?: Record<string, unknown>;
      nativeErrorCode?: unknown;
      readableErrorCode?: unknown;
      domain?: unknown;
    };
    if (e.code != null && String(e.code).length > 0) code = String(e.code);
    else if (e.readableErrorCode != null) code = String(e.readableErrorCode);
    else if (e.nativeErrorCode != null) code = String(e.nativeErrorCode);

    if (typeof e.message === "string" && e.message.trim()) message = e.message.trim();

    const parts: string[] = [];
    if (typeof e.underlyingErrorMessage === "string" && e.underlyingErrorMessage.trim()) {
      parts.push(e.underlyingErrorMessage.trim());
    }
    if (e.domain != null && String(e.domain).length > 0) {
      parts.push(`domain=${String(e.domain)}`);
    }
    const info = e.userInfo;
    if (info && typeof info === "object") {
      const nested =
        info.NSUnderlyingError ?? info.underlyingError ?? info.readableErrorCode ?? info.message;
      if (nested != null && String(nested).length > 0) parts.push(String(nested));
    }
    underlying = parts.length > 0 ? parts.join(" · ") : null;
  } else if (typeof err === "string" && err.trim()) {
    message = err.trim();
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(err, (_k, v) => {
      if (typeof v === "string" && (v.startsWith("appl_") || v.startsWith("test_") || v.includes("sk_"))) {
        return "[redacted]";
      }
      return v;
    });
  } catch {
    serialized = String(err);
  }
  if (serialized.length > 1200) serialized = `${serialized.slice(0, 1197)}…`;

  const short = underlying ? `${code} — ${message} (${underlying})` : `${code} — ${message}`;
  return { code, message, underlying, serialized, short };
}
