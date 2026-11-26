import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Updates from "expo-updates";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConsiderPickCard } from "@/components/TeamPropsSheet";
import { useColors } from "@/hooks/useColors";
import type { ConsiderPick } from "@/lib/teamMatchupConsider";
import type { MatchupEvidence } from "@/lib/matchupEvidence";

function fixturePick(player: string, market: string, line: number): ConsiderPick {
  const center = market === "player_rebounds";
  const price = -110;
  const book = "Fixture sportsbook";
  const quotedAt = "2026-11-25T22:30:00Z";
  return {
    key: market, player, athleteId: null, headshot: null,
    teamSide: center ? "home" : "away", teamName: center ? "New York Knicks" : "Miami Heat",
    oppName: center ? "Miami Heat" : "New York Knicks", position: center ? "C" : "G",
    positionVerified: true, roleKey: market, roleLabel: center ? "Rebounds" : "Assists",
    marketKey: market, marketLabel: center ? "Rebounds" : "Assists",
    side: "Over", line, price, overPrice: price, underPrice: null,
    sportsbook: book, overBook: book, underBook: null, quoteUpdatedAt: quotedAt, quoteStale: false,
    altCount: 0, grade: null, gradeHits: center ? 6 : 7, gradeN: 10,
    edgePct: null, simHitPct: center ? 77.2 : 68, simulations: 10_000, sampleGames: 10,
    meanProjection: center ? 14.2 : 2.1, formSummary: center ? "Recent form 6/10 over 12.5" : "Recent form 7/10 over 1.5",
    opportunitySummary: "Expected minutes unavailable", defenseSummary: "", explanation: "",
    prop: {
      player, market, line, overPrice: price, underPrice: null, alt: false,
      athleteId: null, playerTeamId: null, headshot: null, overBook: book,
      overSourceUpdatedAt: quotedAt,
    },
  };
}

const towns = fixturePick("Karl-Anthony Towns", "player_rebounds", 12.5);
const klay = fixturePick("Klay Thompson", "player_assists", 1.5);
const townsThreshold = "Miami allowed an opposing center over 12.5 rebounds in 0/8 completed games.";
const townsResults = [14, 13, 16, 12, 15, 13, 11, 14, 12, 10];
const townsEvidence: MatchupEvidence = {
  observations: [townsThreshold, "Logged playing time: 32.8 minutes per game in the saved example."],
  positionThreshold: townsThreshold, positionContext: null, opportunity: [],
  recentGameResults: townsResults.map((value, i) => `Fixture game ${i + 1} · ${value} rebounds`),
  cautions: ["Exploratory projection. Calibration is unverified."],
  missing: ["Expected minutes unavailable"],
  source: "Saved Towns example with illustrative game rows and price. No live sportsbook quote.",
};
const klayEvidence: MatchupEvidence = {
  observations: [], positionContext: null, opportunity: [], recentGameResults: [],
  cautions: [], missing: [], source: "Fixed adjacent card for the scroll check.",
};

export default function MatchupPreviewScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const preview = Updates.channel === "preview";
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ padding: 16 }}>
        <Text style={{ color: colors.primary }}>Back</Text>
      </Pressable>
      {preview ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 16 }}>
          <Text style={{ color: colors.foreground, fontSize: 20 }}>Matchup scroll fixture</Text>
          <Text style={{ color: colors.mutedForeground }}>
            Saved Towns matchup example with illustrative prices. Tap Read more and Read less on Towns three times.
            Check that the toggle stays in view and the list does not move to Klay.
          </Text>
          <ConsiderPickCard pick={towns} sport="nba" eventProps={[]} evidence={townsEvidence} onOpen={() => {}} canOpen={false} />
          <ConsiderPickCard pick={klay} sport="nba" eventProps={[]} evidence={klayEvidence} onOpen={() => {}} canOpen={false} />
        </ScrollView>
      ) : <Text style={{ color: colors.mutedForeground, padding: 16 }}>Preview build required.</Text>}
    </View>
  );
}
