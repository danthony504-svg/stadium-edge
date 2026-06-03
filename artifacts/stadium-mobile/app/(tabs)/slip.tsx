import { Feather } from "@expo/vector-icons";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { buildGameMeta, getGames, type EspnGame } from "@/lib/api";
import { formatAmerican, parlayAmerican, parlayImplied, payout } from "@/lib/format";
import { saveSlipToPhotos } from "@/lib/slipImage";

// A game is considered "over" once it has been live longer than any realistic
// game runs. Generous so we never clear a slip whose game is still in play.
const GAME_OVER_BUFFER_MS = 6 * 3600_000;

const teamNick = (s: string) =>
  (s || "").trim().split(/\s+/).filter(Boolean).pop()?.toLowerCase() || "";

// Split a leg's game label ("Away @ Home" / "Away vs Home") into its two team
// nicknames so it can be matched against the live ESPN feed.
function gameTeamNicks(label: string): [string, string] | null {
  const parts = (label || "").split(/\s+@\s+|\s+vs\.?\s+|\s+at\s+/i);
  if (parts.length !== 2) return null;
  return [teamNick(parts[0]), teamNick(parts[1])];
}

// Build a resolver that classifies a leg's game against the live feed:
//   "over"    — confirmed finished (Final/post) or started past the buffer
//   "live"    — found but still upcoming / in progress
//   "unknown" — couldn't be resolved to exactly one game (don't act on it)
// Matching is scoped to the leg's own sport and requires a UNIQUE fixture: if
// zero or multiple games match (cross-sport nickname collision, doubleheader),
// we return "unknown" so the slip is never deleted on an ambiguous match.
function legGameStatus(games: EspnGame[]) {
  return (label: string, sport?: string): "over" | "live" | "unknown" => {
    const teams = gameTeamNicks(label);
    if (!teams) return "unknown";
    const [a, b] = teams;
    if (!a || !b || a === b) return "unknown";
    const candidates = games.filter((g) => {
      if (sport && g.sport && g.sport !== sport) return false;
      const ga = teamNick(g.awayTeam || "");
      const gh = teamNick(g.homeTeam || "");
      return (ga === a && gh === b) || (ga === b && gh === a);
    });
    if (candidates.length !== 1) return "unknown";
    const match = candidates[0];
    const finished = match.state === "post" || /final/i.test(match.status || "");
    if (finished) return "over";
    const t = Date.parse(match.startsAt);
    if (Number.isFinite(t) && Date.now() > t + GAME_OVER_BUFFER_MS) return "over";
    return "live";
  };
}

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
  const [savingImage, setSavingImage] = useState(false);
  const ret = payout(slip.stake, slip.combinedOdds);

  const onSaveToPhotos = async () => {
    if (savingImage || slip.legs.length === 0) return;
    setSavingImage(true);
    Haptics.selectionAsync();
    const result = await saveSlipToPhotos(slip.legs, slip.stake);
    setSavingImage(false);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Your bet slip was saved to Photos.");
    } else if (result.reason === "permission") {
      Alert.alert(
        "Photos access needed",
        "Enable photo access for Stadium Edge in Settings to save your slip.",
      );
    } else {
      Alert.alert("Couldn't save", "Something went wrong saving your slip. Try again.");
    }
  };

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
            onPress={onSaveToPhotos}
            disabled={savingImage}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 12,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: savingImage ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            <Feather
              name={savingImage ? "loader" : "download"}
              size={15}
              color={colors.foreground}
            />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
              {savingImage ? "Saving to Photos…" : "Save to Photos"}
            </Text>
          </Pressable>
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: 10,
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
    deleteSlips,
    aiPicks,
  } = useBetSlip();
  const [savingImage, setSavingImage] = useState(false);

  const onSaveToPhotos = async () => {
    if (savingImage || legs.length === 0) return;
    setSavingImage(true);
    Haptics.selectionAsync();
    const result = await saveSlipToPhotos(legs, stake);
    setSavingImage(false);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Your bet slip was saved to Photos.");
    } else if (result.reason === "permission") {
      Alert.alert(
        "Photos access needed",
        "Enable photo access for Stadium Edge in Settings to save your slip.",
      );
    } else {
      Alert.alert("Couldn't save", "Something went wrong saving your slip. Try again.");
    }
  };

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
  // Fetch ESPN games for every sport referenced by either the AI picks OR the
  // saved slips. The same feed powers two things: re-resolving AI pick art, and
  // detecting which saved slips are fully finished so they can auto-clear.
  const neededSports = useMemo(() => {
    const set = new Set<string>();
    aiPicks.forEach((p) => p.sport && set.add(p.sport));
    savedSlips.forEach((s) => s.legs.forEach((l) => l.sport && set.add(l.sport)));
    return Array.from(set);
  }, [aiPicks, savedSlips]);
  const gamesQueries = useQueries({
    queries: neededSports.map((sport) => ({
      queryKey: ["games", sport],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getGames(sport, signal),
      staleTime: 60_000,
    })),
  });
  const gamesKey = gamesQueries.map((q) => q.dataUpdatedAt).join("|");
  const allGames = useMemo(
    () => gamesQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gamesKey],
  );
  const enrichedAiPicks = useMemo(() => {
    const gameMeta = buildGameMeta(allGames);
    if (gameMeta.length === 0) return aiPicks;
    return aiPicks.map((p) => enrichPickMeta(p, gameMeta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPicks, gamesKey]);

  // Auto-clear saved slips once every game in them is over. A slip is removed
  // only when ALL its games are positively confirmed finished (ESPN Final/post,
  // or started well past a generous game-length buffer). Games we can't resolve
  // in the live feed are treated as "unknown" and keep the slip — never delete
  // on missing data. Finished games drop out of ESPN's window after ~a day, so
  // this clears slips while their results are still visible.
  useEffect(() => {
    if (allGames.length === 0 || savedSlips.length === 0) return;
    const status = legGameStatus(allGames);
    const toRemove = savedSlips
      .filter(
        (s) =>
          s.legs.length > 0 &&
          s.legs.every((l) => status(l.game, l.sport) === "over"),
      )
      .map((s) => s.id);
    if (toRemove.length > 0) deleteSlips(toRemove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamesKey, savedSlips]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
        }}
        bottomOffset={32}
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

              {/* "To win" sits ABOVE the Stake input on purpose: when the
                  number-pad opens it scrolls the focused Stake field just above
                  the keyboard, so anything below it would be hidden. Keeping the
                  payout above the input means the user always sees the amount
                  update as they type, no matter how many legs push the slip down. */}
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

              <Pressable
                onPress={onSaveToPhotos}
                disabled={savingImage}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  paddingVertical: 14,
                  paddingHorizontal: 18,
                  borderRadius: colors.radius,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  opacity: savingImage ? 0.6 : pressed ? 0.85 : 1,
                })}
              >
                <Feather
                  name={savingImage ? "loader" : "download"}
                  size={16}
                  color={colors.foreground}
                />
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                  {savingImage ? "Saving to Photos…" : "Save to Photos"}
                </Text>
              </Pressable>

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
