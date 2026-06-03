import { Feather } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import {
  Alert,
  Dimensions,
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
import { saveSlipToPhotos } from "@/lib/slipImage";

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
// slip). On Coach it lifts above the chat composer, and while the keyboard is up
// it rides above the keyboard so the slip stays reachable mid-conversation. On
// other screens it steps aside while a keyboard (e.g. a search field) is open.
const COMPOSER_CLEARANCE = 66; // approx idle height of the Coach chat composer
// While the keyboard is up on Coach, the composer rides just above the keyboard
// (via KeyboardStickyView) and the dismiss button sits above that. Lift the slip
// bar this far above the keyboard so it clears both and stays usable mid-chat.
const COACH_KB_CLEARANCE = 120;

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

// Coach is special: the slip bar floats COMPOSER_CLEARANCE higher than on other
// screens (it sits above the chat composer), and the chat composer is a flex
// sibling (already out of the scroll area). So the chat list must pad by the
// bar's own footprint PLUS that composer lift, or the last pick card hides
// behind the floating bar. Only when the slip has legs (bar is visible).
export function useCoachSlipClearance() {
  const { legs } = useBetSlip();
  return legs.length > 0 ? COMPOSER_CLEARANCE + SLIP_BAR_CLEARANCE : 0;
}

export function SlipBar({ onNavigateAway }: { onNavigateAway?: () => void } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { legs, combinedOdds, stake, removeLeg, clearLegs } = useBetSlip();
  const [open, setOpen] = useState(false);
  const [kbVisible, setKbVisible] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const [saving, setSaving] = useState(false);

  // Track the soft keyboard so on Coach the bar can ride above it while the user
  // is typing (instead of being hidden), staying reachable mid-chat. We capture
  // the keyboard height to position the bar above it. (No-op on web.)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = (e: { endCoordinates?: { height?: number } }) => {
      setKbVisible(true);
      setKbHeight(e?.endCoordinates?.height ?? 0);
    };
    const hide = () => setKbVisible(false);
    const subs = [
      Keyboard.addListener("keyboardWillShow", show),
      Keyboard.addListener("keyboardDidShow", show),
      Keyboard.addListener("keyboardWillHide", hide),
      Keyboard.addListener("keyboardDidHide", hide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const onCoach = pathname === "/coach" || pathname.startsWith("/coach/");
  const hiddenRoute = pathname === "/slip" || pathname.startsWith("/slip/");

  if (legs.length === 0 || hiddenRoute) return null;
  // On any screen OTHER than Coach, the keyboard (e.g. a search field) owns the
  // bottom while typing — step aside so we never cover what the user is editing.
  if (!onCoach && kbVisible) return null;

  const toWin = payout(stake, combinedOdds) - stake;

  // Bottom offset for the floating bar:
  //  - Coach + keyboard up: ride above the keyboard and the chat composer so the
  //    slip stays reachable mid-conversation (the user asked for this).
  //  - Coach + keyboard down: sit above the idle composer.
  //  - Everywhere else: a small safe-area gap.
  const barBottom =
    onCoach && kbVisible
      ? kbHeight + COACH_KB_CLEARANCE
      : insets.bottom + 12 + (onCoach ? COMPOSER_CLEARANCE : 0);

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

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const result = await saveSlipToPhotos(legs, stake);
    setSaving(false);
    if (result.ok) {
      if (Platform.OS !== "web")
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

  // The expanded leg list scrolls inside a capped area so it never grows past the
  // visible screen. The cap must shrink when the bar floats high (e.g. above the
  // keyboard on Coach), otherwise the list + summary bar overflow the top and the
  // LAST pick gets clipped off-screen with no way to reach it. Budget the space
  // from the bar's bottom offset up to a top safe margin, reserving room for the
  // expanded card's own chrome (list header + action row footer) plus the summary
  // bar and gaps that sit below the list. Critically, the cap must NEVER be forced
  // above the genuinely-available space — a hard floor taller than what's left is
  // exactly what pushes the top (and the last pick) off-screen. So we only apply a
  // comfortable minimum when there's actually room for it; in a truly cramped
  // layout we let the list shrink to whatever fits and rely on scrolling.
  const screenH = Dimensions.get("window").height;
  const RESERVED = 200; // card header + footer + summary bar + gaps
  const available = Math.max(0, screenH - barBottom - insets.top - RESERVED);
  const listMaxHeight =
    available >= 120 ? Math.min(320, available) : available;

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
          bottom: barBottom,
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

            <ScrollView style={{ maxHeight: listMaxHeight }} showsVerticalScrollIndicator={false}>
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

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <Pressable
                onPress={onSave}
                disabled={saving}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingVertical: 12,
                  opacity: saving ? 0.6 : pressed ? 0.85 : 1,
                })}
              >
                <Feather
                  name={saving ? "loader" : "download"}
                  size={14}
                  color={colors.foreground}
                />
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>
                  {saving ? "Saving…" : "Save to Photos"}
                </Text>
              </Pressable>

              <View style={{ width: 1, backgroundColor: colors.border, alignSelf: "stretch" }} />

              <Pressable
                onPress={openSlip}
                style={({ pressed }) => ({
                  flex: 1,
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
