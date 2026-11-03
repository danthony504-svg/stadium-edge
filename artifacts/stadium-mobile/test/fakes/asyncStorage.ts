// Native persistence is isolated from Node pipeline tests.
const rows = new Map<string, string>();
export default {
  async getItem(key: string) { return rows.get(key) ?? null; },
  async setItem(key: string, value: string) { rows.set(key, value); },
  async removeItem(key: string) { rows.delete(key); },
  async clear() { rows.clear(); },
};
