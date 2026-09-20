import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@stadium/recent_searches";
const MAX_RECENT = 8;

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  } catch {
    return [];
  }
}

export async function rememberRecentSearch(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return loadRecentSearches();
  const prev = await loadRecentSearches();
  const next = [q, ...prev.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore persistence failures
  }
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
