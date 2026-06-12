import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getTennisPlayer, type TennisPlayerProfile } from "@/lib/api";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

// Compact USD prize-money label, e.g. 2134590 -> "$2.1M", 480000 -> "$480K".
function prizeStr(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

// Full-screen "stats sheet" for a single tennis player. Every value is REAL ESPN
// data resolved by buildTennisPlayer; any field ESPN doesn't carry is omitted,
// never fabricated. Tennis has no per-match box-score feed, so the sheet shows
// bio + ranking + career singles record + recent form (not game-log bars).
export function TennisPlayerSheet({
  name,
  fallbackName,
  visible,
  onClose,
}: {
  name: string | null;
  fallbackName?: string;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery<TennisPlayerProfile | null>({
    queryKey: ["tennis-player", name],
    queryFn: ({ signal }) => getTennisPlayer(name || "", signal),
    enabled: visible && !!name,
    staleTime: 5 * 60 * 1000,
  });

  const title = data?.resolvedName || fallbackName || name || "Player";
  const rank = data?.rank ?? null;
  const tour = data?.tour;
  const bio = data?.bio || null;
  const career = data?.career || null;
  const form = data?.recentForm || [];

  const bioChips: Array<{ label: string; value: string }> = [];
  if (data?.country) bioChips.push({ label: "Country", value: data.country });
  if (bio?.age != null) bioChips.push({ label: "Age", value: String(bio.age) });
  if (bio?.height) bioChips.push({ label: "Height", value: bio.height });
  if (bio?.weight) bioChips.push({ label: "Weight", value: bio.weight });
  if (bio?.plays) bioChips.push({ label: "Plays", value: bio.plays });
  if (bio?.turnedPro != null) bioChips.push({ label: "Turned pro", value: String(bio.turnedPro) });
  if (bio?.birthPlace) bioChips.push({ label: "Birthplace", value: bio.birthPlace });

  const careerStats: Array<{ label: string; value: string }> = [];
  if (career?.wins != null && career?.losses != null)
    careerStats.push({ label: "Singles W-L", value: `${career.wins}-${career.losses}` });
  if (career?.winPct != null) careerStats.push({ label: "Win %", value: `${career.winPct}%` });
  if (career?.singlesTitles != null)
    careerStats.push({ label: "Singles titles", value: String(career.singlesTitles) });
  if (career?.doublesTitles != null)
    careerStats.push({ label: "Doubles titles", value: String(career.doublesTitles) });
  if (career?.prize != null) careerStats.push({ label: "Career prize", value: prizeStr(career.prize) });

  const wins = form.filter((r) => r.win === true).length;
  const losses = form.filter((r) => r.win === false).length;
  const hasAny = !!rank || bioChips.length > 0 || careerStats.length > 0 || form.length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderColor: colors.border,
            borderWidth: 1,
            maxHeight: "86%",
            paddingBottom: insets.bottom + 12,
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text
                style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}
                numberOfLines={1}
              >
                {title}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, letterSpacing: 0.5 }}>
                REAL DATA · ESPN {tour || "ATP/WTA"}
              </Text>
            </View>
            {rank != null ? (
              <View
                style={{
                  backgroundColor: "rgba(56,189,248,0.12)",
                  borderColor: "rgba(56,189,248,0.4)",
                  borderWidth: 1,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 14 }}>
                  {`${tour || ""} #${rank}`.trim()}
                </Text>
                {data?.rankPoints != null ? (
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9, textAlign: "right" }}>
                    {data.rankPoints.toLocaleString()} pts
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {isLoading && !data ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 24 }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                Loading player stats…
              </Text>
            </View>
          ) : !hasAny ? (
            <View style={{ padding: 24 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                No stats available for this player.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} showsVerticalScrollIndicator={false}>
              {/* Bio */}
              {bioChips.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 12, letterSpacing: 0.5 }}>
                    PLAYER
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {bioChips.map((c) => (
                      <View
                        key={c.label}
                        style={{
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                          borderWidth: 1,
                          borderRadius: 10,
                          paddingHorizontal: 11,
                          paddingVertical: 7,
                          gap: 1,
                        }}
                      >
                        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9.5, letterSpacing: 0.3 }}>
                          {c.label.toUpperCase()}
                        </Text>
                        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
                          {c.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Career */}
              {careerStats.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 12, letterSpacing: 0.5 }}>
                    CAREER (SINGLES)
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    {careerStats.map((s, i) => (
                      <View
                        key={s.label}
                        style={{
                          width: "50%",
                          padding: 12,
                          gap: 2,
                          borderTopWidth: i >= 2 ? 1 : 0,
                          borderLeftWidth: i % 2 === 1 ? 1 : 0,
                          borderColor: colors.border,
                        }}
                      >
                        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, letterSpacing: 0.3 }}>
                          {s.label.toUpperCase()}
                        </Text>
                        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
                          {s.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Recent form */}
              {form.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 12, letterSpacing: 0.5 }}>
                    RECENT FORM{" "}
                    <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
                      ({wins}-{losses} this season)
                    </Text>
                  </Text>
                  <View
                    style={{
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 12,
                      padding: 12,
                      gap: 9,
                    }}
                  >
                    {form.map((r, i) => (
                      <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 5,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor:
                              r.win === true
                                ? "rgba(16,185,129,0.18)"
                                : r.win === false
                                  ? "rgba(239,68,68,0.16)"
                                  : "rgba(148,163,184,0.16)",
                          }}
                        >
                          <Text
                            style={{
                              color: r.win === true ? "#10b981" : r.win === false ? "#ef4444" : colors.mutedForeground,
                              fontFamily: FONT.semibold,
                              fontSize: 10,
                            }}
                          >
                            {r.win === true ? "W" : r.win === false ? "L" : "·"}
                          </Text>
                        </View>
                        <Text
                          style={{ flex: 1, color: colors.foreground, fontFamily: FONT.body, fontSize: 12.5 }}
                          numberOfLines={1}
                        >
                          {r.opponent ? `vs ${nickname(r.opponent)}` : "—"}
                          {r.round ? ` · ${r.round}` : ""}
                        </Text>
                        {r.score ? (
                          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
                            {r.score}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
