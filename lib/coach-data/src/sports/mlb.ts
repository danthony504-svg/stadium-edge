import type { CoachCandidateLeg, CoachSportAdapter, CoachSportContext } from "@workspace/coach-types";

import { legsFromEnumerateInput, passingSportGate } from "../candidates";

const MLB_GAME_MARKETS = [
  { kind: "moneyline" as const, marketKey: "h2h", displayLabel: "Moneyline", supportsAlts: false, simModel: "inning" as const },
  { kind: "spread" as const, marketKey: "spreads", displayLabel: "Run Line", supportsAlts: true, simModel: "inning" as const },
  { kind: "total" as const, marketKey: "totals", displayLabel: "Game Total", supportsAlts: true, simModel: "inning" as const },
  { kind: "team_total" as const, marketKey: "team_totals", displayLabel: "Team Total", supportsAlts: true, simModel: "inning" as const },
];

const MLB_PROP_MARKETS = [
  { kind: "player_stat" as const, marketKey: "batter_hits", displayLabel: "Batter Hits", supportsAlts: true, simModel: "inning" as const },
  { kind: "player_stat" as const, marketKey: "batter_total_bases", displayLabel: "Total Bases", supportsAlts: true, simModel: "inning" as const },
  { kind: "player_stat" as const, marketKey: "batter_home_runs", displayLabel: "Home Runs", supportsAlts: true, simModel: "inning" as const },
  { kind: "player_stat" as const, marketKey: "pitcher_strikeouts", displayLabel: "Pitcher Strikeouts", supportsAlts: true, simModel: "inning" as const },
  { kind: "player_stat" as const, marketKey: "batter_stolen_bases", displayLabel: "Stolen Bases", supportsAlts: false, simModel: "inning" as const },
  { kind: "player_combo" as const, marketKey: "batter_hits_runs_rbis", displayLabel: "Hits + Runs + RBIs", supportsAlts: true, simModel: "inning" as const },
];

const MLB_PROP_KEYS = new Set(MLB_PROP_MARKETS.map((m) => m.marketKey));
const MLB_GAME_KEYS = new Set(MLB_GAME_MARKETS.map((m) => m.marketKey));

export function createMlbAdapter(): CoachSportAdapter {
  return {
    sportId: "mlb",
    displayName: "MLB",

    supportedGameMarkets: () => MLB_GAME_MARKETS,
    supportedPropMarkets: () => MLB_PROP_MARKETS,

    enumerateCandidates(input) {
      return legsFromEnumerateInput({
        sport: "mlb",
        gameLines: input.gameLines.filter((line) => MLB_GAME_KEYS.has(line.marketKey)),
        props: input.props.filter((prop) => MLB_PROP_KEYS.has(prop.marketKey)),
      });
    },

    evaluateSportSpecific(candidate: CoachCandidateLeg, _context: CoachSportContext) {
      if (candidate.sport !== "mlb") {
        return {
          gateId: "sport_specific",
          pass: false,
          reasonCode: "sport_rule_violation",
          message: "Not an MLB market",
        };
      }
      if (candidate.kind === "player_prop" && !MLB_PROP_KEYS.has(candidate.marketKey)) {
        return {
          gateId: "sport_specific",
          pass: false,
          reasonCode: "sport_market_unsupported",
          message: `Unsupported MLB prop market: ${candidate.marketKey}`,
        };
      }
      if (candidate.kind === "game_line" && !MLB_GAME_KEYS.has(candidate.marketKey)) {
        return {
          gateId: "sport_specific",
          pass: false,
          reasonCode: "sport_market_unsupported",
          message: `Unsupported MLB game market: ${candidate.marketKey}`,
        };
      }
      return passingSportGate("MLB market supported");
    },
  };
}
