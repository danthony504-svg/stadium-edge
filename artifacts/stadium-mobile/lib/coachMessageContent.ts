/** Reject transport diagnostics that must never become visible Coach bubbles. */
export function isCoachDiagnosticContent(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const text = value.trim();
  if (!text) return false;
  if (/^\d+$/.test(text)) return true;
  if (/^[a-z]$/i.test(text)) return true;
  if (/^HTTP\s+\d{3}(?:\b|$)/i.test(text)) return true;
  if (/^(?:request|req|build|trace|diagnostic)[_:= -][a-z0-9._-]+$/i.test(text)) return true;
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(text);
}

/** Return visible content only; diagnostics stay available in transport logs. */
export function visibleCoachMessageContent(value: unknown): string {
  return isCoachDiagnosticContent(value) ? "" : String(value).trim();
}
