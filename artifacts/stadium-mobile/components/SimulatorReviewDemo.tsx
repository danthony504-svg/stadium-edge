import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Updates from "expo-updates";

import { EventSimulationSummary, NbaPossessionSummary } from "@/components/NbaPossessionSummary";
import { GameReplay, type ReplaySport } from "@/components/NflDriveReplay";
import { Card, FONT, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { simulatorReviewFixtures as examples } from "@/lib/simulatorReviewFixtures";

const labels: Partial<Record<ReplaySport, string>> = { soccer: "Soccer", tennis: "Tennis" };

export function SimulatorReviewDemo() {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (Updates.channel !== "preview") return null;
  const example = examples[index];
  if (!example) return null;

  const { sport, lines, result } = example;
  const home = sport === "tennis" ? "Player A" : "Blue";
  const away = sport === "tennis" ? "Player B" : "Gold";
  const event = result.eventSimulation?.representative;
  const periods = event?.periods ?? result.nbaPossessions?.representative.periods.map((period, i) => ({
    ...period, label: i < 4 ? `Q${i + 1}` : `OT ${i - 3}`,
  }));
  const detail = { color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 };

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 16, gap: 12 }}>
      <Card style={{ gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}>
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 16 }}>
            {open ? "Close simulator demo" : "Try the new simulator"}
          </Text>
        </Pressable>
        <Text style={detail}>Review demo · synthetic teams, players, and lines</Text>
      </Card>
      {open && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {examples.map((item, i) => (
              <Pill key={item.sport} label={labels[item.sport] ?? item.sport.toUpperCase()} active={i === index} onPress={() => setIndex(i)} />
            ))}
          </ScrollView>
          {!!periods?.length && (
            <GameReplay key={sport} sport={sport} home={home} away={away} matchupTime="Synthetic demo"
              simulations={result.simulations} sampledPeriods={periods}
              sampledCaption={event?.tiebreak ? `Median modeled margin · decided by ${event.tiebreak}` : "Median modeled margin"} />
          )}
          {result.eventSimulation && (
            <EventSimulationSummary data={result.eventSimulation} home={home} away={away} lines={lines} showPlayers={false}
              drawProbability={sport === "soccer" ? result.tieProbability : null} />
          )}
          {result.nbaPossessions && (
            <NbaPossessionSummary data={result.nbaPossessions} home={home} away={away} lines={lines} showPlayers={false} />
          )}
        </>
      )}
    </View>
  );
}
