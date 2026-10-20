/** Conservative fallback for provider search; returned identities still require validation. */
export function teamSearchFallbackQuery(query: string): string | null {
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  // Strip a club designator only when a multi-word identifying name remains.
  const stripped = normalized.replace(/^(?:sk|fk|fc|afc|ac|as|nk)\s+/i, "");
  const fallback = stripped.split(/\s+/).length >= 2 ? stripped : normalized;
  return fallback !== query && fallback.length >= 2 ? fallback : null;
}
