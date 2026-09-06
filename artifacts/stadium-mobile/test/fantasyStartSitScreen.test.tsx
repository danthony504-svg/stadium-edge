import React from "react";
import TestRenderer from "react-test-renderer";

import FantasyStartSitScreen, { canComparePlayers } from "../app/fantasy-start-sit";

const mockBack = jest.fn();
const mockSearchPlayer = jest.fn(async () => ({ results: [{ athleteId: "b", name: "Player B", position: "WR", team: "SEA", sport: "nfl" }] }));
const mockReact = React;

jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }), useLocalSearchParams: () => ({ playerAId: "a" }) }));
jest.mock("@expo/vector-icons", () => ({ Feather: "Feather" }));
jest.mock("@/components/AppHeader", () => ({ AppHeader: "AppHeader" }));
jest.mock("@/components/ui", () => ({
  Card: "Card",
  FONT: { display: "display", body: "body", bold: "bold", semibold: "semibold", medium: "medium" },
  Pill: ({ label, onPress }: { label: string; onPress: () => void }) => {
    const { Pressable, Text } = require("react-native");
    return mockReact.createElement(Pressable, { accessibilityLabel: label, onPress }, mockReact.createElement(Text, null, label));
  },
}));
jest.mock("@/hooks/useColors", () => ({ useColors: () => ({ background: "#0f172a", card: "#111827", border: "#334155", foreground: "#f8fafc", mutedForeground: "#94a3b8", primary: "#38bdf8", primaryForeground: "#020617" }) }));
jest.mock("@/context/FantasyRosterContext", () => ({ useFantasyRoster: () => ({ defaultRoster: { scoringFormat: "ppr", players: [{ athleteId: "a", name: "Josh Allen", position: "QB", team: "BUF" }] } }) }));
jest.mock("@/lib/api", () => ({ searchPlayer: (...args: unknown[]) => mockSearchPlayer(...args), getFantasyNflPlayerHistory: jest.fn(), getInjuries: jest.fn() }));
jest.mock("@/lib/fantasyNflAnalysis", () => ({ historicalFantasyAnalysis: jest.fn() }));

test("Start/Sit has readable controls, selects Player B, and returns to the team", async () => {
  let screen!: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { screen = TestRenderer.create(<FantasyStartSitScreen />); });
  const json = JSON.stringify(screen.toJSON());
  expect(json).toContain("Josh Allen");
  expect(json).toContain("#f8fafc");
  expect(json).toContain("#38bdf8");

  expect(screen.root.findAll((node) => node.props.accessibilityLabel === "Search NFL player").length).toBeGreaterThan(0);
  const compare = screen.root.findAll((node) => node.props.accessibilityLabel === "Compare Players")[0];
  expect(compare.props.disabled).toBe(true);
  expect(canComparePlayers({ athleteId: "a" }, null)).toBe(false);
  expect(canComparePlayers({ athleteId: "a" }, { athleteId: "b" })).toBe(true);
  const back = screen.root.findAll((node) => node.props.accessibilityLabel === "Back to My Fantasy Team")[0];
  back.props.onPress();
  expect(mockBack).toHaveBeenCalledTimes(1);
});
