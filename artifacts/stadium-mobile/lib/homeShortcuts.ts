/**
 * Discover Home quick-action destinations.
 * Hot Picks / Easy Money → Coach (distinct ticket styles via ask text).
 * Best Value → Props board (existing prop scan — no duplicate Coach scan).
 * Longshots → +500 Steals feed (existing longshot scan).
 *
 * Ticket styles still go through Final AI / sim / NCAAF P0 / period gates —
 * these prompts only select ranking style, they do not weaken qualification.
 */

/** Lightweight labels — avoid importing sports.ts (vector-icons) into unit tests. */
const SPORT_LABELS: Record<string, string> = {
  mlb: "MLB",
  nfl: "NFL",
  ncaaf: "CFB",
  ncaab: "CBB",
  wnba: "WNBA",
  nba: "NBA",
  nhl: "NHL",
  soccer: "Soccer",
  tennis: "Tennis",
  ufc: "UFC",
};

function shortcutSportLabel(sportId: string): string {
  return SPORT_LABELS[sportId] ?? sportId.toUpperCase();
}

export type HomeShortcutId = "hot_picks" | "easy_money" | "best_value" | "longshots";

export type HomeShortcutDest =
  | {
      id: HomeShortcutId;
      kind: "coach";
      autoMsg: string;
      /** Silent home launch — hide user bubble. */
      silent: boolean;
    }
  | {
      id: HomeShortcutId;
      kind: "props";
      pathname: "/props";
      sport: string | null;
    }
  | {
      id: HomeShortcutId;
      kind: "steals";
      pathname: "/steals";
      sport: string | null;
    };

/** Distinct Coach asks — detectCoachTicketStyle maps safe → safe, else balanced. */
export function homeShortcutCoachAsk(
  id: "hot_picks" | "easy_money",
  sportId: string,
): string {
  const label = shortcutSportLabel(sportId);
  if (id === "easy_money") {
    return `Build me a safe ${label} parlay for tonight`;
  }
  // Hot Picks — balanced "best/top" ask scoped to the selected sport.
  return `Build me the best ${label} parlay for tonight`;
}

export function resolveHomeShortcut(
  id: HomeShortcutId,
  sportId: string,
  opts?: { propsSportSupported?: boolean },
): HomeShortcutDest {
  const propsOk = opts?.propsSportSupported ?? true;
  switch (id) {
    case "hot_picks":
      return {
        id,
        kind: "coach",
        autoMsg: homeShortcutCoachAsk("hot_picks", sportId),
        silent: true,
      };
    case "easy_money":
      return {
        id,
        kind: "coach",
        autoMsg: homeShortcutCoachAsk("easy_money", sportId),
        silent: false,
      };
    case "best_value":
      return {
        id,
        kind: "props",
        pathname: "/props",
        sport: propsOk ? sportId : null,
      };
    case "longshots":
      return {
        id,
        kind: "steals",
        pathname: "/steals",
        sport: sportId,
      };
  }
}
