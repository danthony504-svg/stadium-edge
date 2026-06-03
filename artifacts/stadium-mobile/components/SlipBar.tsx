import { Feather } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  Text,
  UIManager,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { formatAmerican, payout } from "@/lib/format";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// A floating "pop-up" bet slip pinned to the bottom of the screen. It shows a
// compact summary bar (leg count + combined odds + projected payout) whenever
// the slip has legs, and expands into a scrollable list of legs (each removable)
// with a shortcut to the full Slip tab. On iOS a root-level overlay does NOT
// reliably paint over a nested native stack, so this is rendered as a sibling of
// each screen's own stack — once in (tabs)/_layout (covers every tab) and once
// inside each root-stack route (game/[id], upcoming) and the fullScreen
// PlayerPropsSheet Modal. Hidden on the Slip tab itself (that screen IS the full
// slip). On Coach it lifts above the chat composer and hides while the keyboard
// is up so it never covers what the user is typing.
const COMPOSER_CLEARANCE = 66; // approx idle height of the Coach chat composer

// Extra bottom padding a scrollable screen should add so its last items can
// scroll clear of the floating slip bar (summary bar height + its bottom offset
// + a small gap). Only needed when the slip actually has legs (bar is visible).
export const SLIP_BAR_CLEARANCE = 76;

// Returns the bottom padding a scroll list should add on top of its normal
// safe-area padding so content isn't hidden behind the floating SlipBar.
export function useSlipClearance() {
  const { legs } = useBetSlip();
  return legs.length > 0 ? SLIP_BAR_CLEARANCE : 0;
}

export function SlipBar({ onNavigateAway }: { onNavigateAway?: () => void } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { legs, combinedOdds, stake, removeLeg, clearLegs } = useBetSlip();
  const [open, setOpen] = useState(false);
  const [kbVisible, setKbVisible] = useState(false);

  // Track the soft keyboard so the bar can step aside on the Coach screen while
  // typing. (No-op on web — these events never fire there.)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subs = [
      Keyboard.addListener("keyboardWillShow", () => setKbVisible(true)),
      Keyboard.addListener("keyboardDidShow", () => setKbVisible(true)),
      Keyboard.addListener("keyboardWillHide", () => setKbVisible(false)),
      Keyboard.addListener("keyboardDidHide", () => setKbVisible(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const onCoach = pathname === "/coach" || pathname.startsWith("/coach/");
  const hiddenRoute = pathname === "/slip" || pathname.startsWith("/slip/");

  if (legs.length === 0 || hiddenRoute) return null;
  // On Coach, the composer (and risen keyboard) own the bottom while typing.
  if (onCoach && kbVisible) return null;

  const toWin = payout(stake, combinedOdds) - stake;

  const toggle = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  const onRemove = (id: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    removeLeg(id);
  };

  const openSlip = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setOpen(false);
    onNavigateAway?.(); // e.g. close the modal hosting this bar before navigating
    router.navigate("/slip" as any);
  };

  const onClear = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    clearLegs();
    setOpen(false);
  };

  return (
    <>
      {/* Tap-away backdrop while expanded */}
      {open ? (
        <Pressable
          onPress={toggle}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}

      <View
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: insets.bottom + 12 + (onCoach ? COMPOSER_CLEARANCE : 0),
        }}
      >
        {/* Expanded leg list (sits above the summary bar) */}
        {open ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              marginBottom: 8,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
                Your Slip · {legs.length} {legs.length === 1 ? "leg" : "legs"}
              </Text>
              <Pressable onPress={onClear} hitSlop={8}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 12 }}>
                  Clear all
                </Text>
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
              {legs.map((leg) => (
                <View
                  key={leg.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}
                      numberOfLines={1}
                    >
                      {leg.pick}
                    </Text>
                    <Text
                      style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11, marginTop: 2 }}
                      numberOfLines={1}
                    >
                      {leg.market} · {leg.game}
                    </Text>
                  </View>
                  <Text style={{ color: colors.accent, fontFamily: FONT.bold, fontSize: 13 }}>
                    {formatAmerican(leg.odds)}
                  </Text>
                  <Pressable onPress={() => onRemove(leg.id)} hitSlop={8}>
                    <Feather name="x" size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <Pressable
              onPress={openSlip}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 12,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 13 }}>
                Open full slip
              </Text>
              <Feather name="arrow-right" size={14} color={colors.primary} />
            </Pressable>
          </View>
        ) : null}

        {/* Summary bar */}
        <Pressable
          onPress={toggle}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            paddingVertical: 12,
            paddingHorizontal: 14,
            opacity: pressed ? 0.92 : 1,
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          })}
        >
          <View
            style={{
              minWidth: 26,
              height: 26,
              borderRadius: 13,
              paddingHorizontal: 6,
              backgroundColor: colors.primaryForeground,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 13 }}>
              {legs.length}
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold, fontSize: 14 }}>
              Bet Slip {combinedOdds != null ? `· ${formatAmerican(combinedOdds)}` : ""}
            </Text>
            <Text style={{ color: colors.primaryForeground, fontFamily: FONT.medium, fontSize: 11, opacity: 0.85 }}>
              ${stake.toFixed(0)} to win ${toWin.toFixed(2)}
            </Text>
          </View>

          <Feather
            name={open ? "chevron-down" : "chevron-up"}
            size={20}
            color={colors.primaryForeground}
          />
        </Pressable>
      </View>
    </>
  );
}
