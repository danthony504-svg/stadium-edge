import type { CoachSportAdapter, CoachSportIdOrCustom, CoachSportRegistry } from "@workspace/coach-types";

export function createSportRegistry(initial: CoachSportAdapter[] = []): CoachSportRegistry {
  const adapters = new Map<string, CoachSportAdapter>();
  for (const adapter of initial) {
    adapters.set(normalizeKey(adapter.sportId), adapter);
  }

  return {
    register(adapter) {
      adapters.set(normalizeKey(adapter.sportId), adapter);
    },
    get(sportId) {
      return adapters.get(normalizeKey(sportId));
    },
    has(sportId) {
      return adapters.has(normalizeKey(sportId));
    },
    all() {
      return [...adapters.values()];
    },
    sportIds() {
      return [...adapters.keys()];
    },
  };
}

function normalizeKey(sportId: CoachSportIdOrCustom): string {
  return String(sportId).toLowerCase().trim();
}
