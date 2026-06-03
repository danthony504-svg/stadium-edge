import { Feather } from "@expo/vector-icons";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiPickCard } from "@/components/AiPickCard";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { enrichPickMeta } from "@/components/PickCard";
import { Badge, EmptyState, FONT, PrimaryButton, SectionHeader } from "@/components/ui";
import { useBetSlip, type Leg, type SavedSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { buildGameMeta, getGames } from "@/lib/api";
import { formatAmerican, parlayAmerican, parlayImplied, payout } from "@/lib/format";

function LegRow({ leg, onRemove }: { leg: Leg; onRemove?: () => void }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
          {leg.pick}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
          {leg.market} · {leg.game}
        </Text>
      </View>
      <Text style={{ color: colors.accent, fontFamily: FONT.bold, fontSize: 14 }}>
        {formatAmerican(leg.odds)}
      </Text>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 4 }}>
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}


function SavedSlipCard({ slip, onDelete }: { slip: SavedSlip; onDelete: () => void }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const ret = payout(slip.stake, slip.combinedOdds);
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
      }}
    >
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Badge label={`${slip.legs.length} LEG`} tone="primary" />
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
            {formatAmerican(slip.combinedOdds)}
          </Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </Pressable>

      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 6 }}>
        ${slip.stake.toFixed(0)} → ${ret.toFixed(2)} · {new Date(slip.createdAt).toLocaleDateString()}
      </Text>

      {open ? (
        <View style={{ marginTop: 8 }}>
          {slip.legs.map((l) => (
            <LegRow key={l.id} leg={l} />
          ))}
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: 12,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Feather name="trash-2" size={15} color={colors.destructive} />
            <Text style={{ color: colors.destructive, fontFamily: FONT.semibold, fontSize: 13 }}>
              Delete slip
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function SlipScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    legs,
    savedSlips,
    stake,
    setStake,
    removeLeg,
    clearLegs,
    saveCurrentSlip,
    deleteSlip,
    aiPicks,
  } = useBetSlip();

  const combined = parlayAmerican(legs.map((l) => l.odds));
  // "To win" is profit only — the winnings on top of the stake, NOT the total
  // return. payout() includes the stake, so subtract it back out.
  const toWin = payout(stake, combined) - stake;
  const implied = parlayImplied(legs.map((l) => l.odds));

  // aiPicks is an in-memory store that can predate the parser that attaches team
  // logos (e.g. after a code change while the app is open). Re-resolve each
  // pick's logos/codes here from a fresh ESPN games fetch so cards always show
  // the real matchup/team art without forcing the user to regenerate. Real data
  // only — enrichPickMeta is non-destructive and never invents anything.
  const aiSports = useMemo(
    () => Array.from(new Set(aiPicks.map((p) => p.sport).filter((s): s is string => !!s))),
    [aiPicks],
  );
  const gamesQueries = useQueries({
    queries: aiSports.map((sport) => ({
      queryKey: ["games", sport],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getGames(sport, signal),
      staleTime: 60_000,
    })),
  });
  const gamesKey = gamesQueries.map((q) => q.dataUpdatedAt).join("|");
  const enrichedAiPicks = useMemo(() => {
    const gameMeta = buildGameMeta(gamesQueries.flatMap((q) => q.data ?? []));
    if (gameMeta.length === 0) return aiPicks;
    return aiPicks.map((p) => enrichPickMeta(p, gameMeta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPicks, gamesKey]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
        }}
        bottomOffset={24}
      >
        <View style={{ marginBottom: 16, paddingLeft: 48 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
            Bet Slip
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
            {legs.length === 0 ? "No legs yet" : `${legs.length}-leg parlay`}
          </Text>
        </View>

        {/* AI-recommended picks (pinned from the AI Coach's latest parlay) */}
        {enrichedAiPicks.length > 0 ? (
          <View style={{ marginBottom: 20 }}>
            <Text
              style={{
                color: colors.primary,
                fontFamily: FONT.display,
                fontSize: 13,
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              ★ AI RECOMMENDED
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingRight: 4 }}
            >
              {enrichedAiPicks.map((p, i) => (
                <AiPickCard key={`${p.game}|${p.pick}|${i}`} pick={p} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {legs.length === 0 ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              marginBottom: 24,
            }}
          >
            <EmptyState
              icon="layers"
              title="Your slip is empty"
              subtitle="Add legs from the Home board or ask the AI Coach to build you a parlay."
            />
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <PrimaryButton label="Ask the AI Coach" icon="zap" onPress={() => router.push("/coach")} />
            </View>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              padding: 14,
              marginBottom: 24,
            }}
          >
            {legs.map((l) => (
              <LegRow key={l.id} leg={l} onRemove={() => removeLeg(l.id)} />
            ))}

            {/* Stake + payout */}
            <View style={{ marginTop: 14, gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
                  Combined odds
                </Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16 }}>
                  {formatAmerican(combined)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
                  Implied win prob
                </Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                  {(implied * 100).toFixed(1)}%
                </Text>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
                  Stake
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 15 }}>$</Text>
                  <TextInput
                    value={String(stake)}
                    onChangeText={(t) => setStake(parseInt(t.replace(/[^0-9]/g, ""), 10) || 0)}
                    keyboardType="number-pad"
                    style={{
                      flex: 1,
                      color: colors.foreground,
                      fontFamily: FONT.bold,
                      fontSize: 15,
                      paddingVertical: 10,
                      paddingHorizontal: 6,
                    }}
                  />
                </View>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "rgba(34,197,94,0.12)",
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <Text style={{ color: colors.success, fontFamily: FONT.semibold, fontSize: 14 }}>
                  To win
                </Text>
                <Text style={{ color: colors.success, fontFamily: FONT.display, fontSize: 20 }}>
                  ${toWin.toFixed(2)}
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => {
                    clearLegs();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    paddingVertical: 14,
                    paddingHorizontal: 18,
                    borderRadius: colors.radius,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 14 }}>
                    Clear
                  </Text>
                </Pressable>
                <PrimaryButton
                  label="Save slip"
                  icon="bookmark"
                  style={{ flex: 1 }}
                  onPress={() => {
                    if (saveCurrentSlip()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                />
              </View>
            </View>
          </View>
        )}

        {savedSlips.length > 0 ? (
          <>
            <SectionHeader title="Saved Slips" />
            <View style={{ gap: 12 }}>
              {savedSlips.map((s) => (
                <SavedSlipCard key={s.id} slip={s} onDelete={() => deleteSlip(s.id)} />
              ))}
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
