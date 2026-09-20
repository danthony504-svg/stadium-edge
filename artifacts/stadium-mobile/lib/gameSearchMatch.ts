// Match a game label against free-text queries like "Dodgers vs Yankees".
export function gameMatchesQuery(gameLabel: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const label = gameLabel.toLowerCase();
  if (label.includes(q)) return true;
  const normalized = q.replace(/\s+vs\.?\s+/gi, " @ ").replace(/\s+@\s+/g, " @ ");
  const parts = normalized.split(/\s+@\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2) {
    const [a, b] = parts;
    return label.includes(a) && label.includes(b);
  }
  return false;
}
