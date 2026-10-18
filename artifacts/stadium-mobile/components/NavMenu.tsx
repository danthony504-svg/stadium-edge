import { useAuth } from "@clerk/expo";
import Feather from "@expo/vector-icons/Feather";
import { BlurView } from "expo-blur";
import { usePathname, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import { setTourMenuFocus, subscribeTourMenuFocus, type TourMenuFocus } from "@/lib/tourMenuFocus";
import { Dimensions, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import {
  PREMIUM_FEATURES,
  premiumFeatureForRoute,
} from "@/lib/entitlements";
import {
  accountMenuItem,
  plansMenuItem,
  shouldShowOtaDiagnosticsMenuItem,
} from "@/lib/navMenuAuth";
import { SLIP_UI_ENABLED } from "@/lib/slipUi";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const DESTINATIONS: { label: string; route: string; icon: FeatherName }[] = [
  { label: "Discover", route: "/", icon: "compass" },
  { label: "Coach", route: "/coach", icon: "zap" },
  { label: "Fantasy Football", route: "/fantasy", icon: "award" },
  { label: "Park Weather", route: "/weather", icon: "cloud-drizzle" },
  { label: "Props", route: "/props", icon: "user" },
  { label: "Simulator", route: "/simulator", icon: "cpu" },
  { label: "Edge Lock", route: "/arbitrage", icon: "repeat" },
  { label: "+500 Steals", route: "/steals", icon: "target" },
  ...(SLIP_UI_ENABLED
    ? [{ label: "Slip", route: "/slip", icon: "layers" as FeatherName }]
    : []),
  { label: "Model Report", route: "/report", icon: "bar-chart-2" },
];

function isActive(pathname: string, route: string) {
  if (route === "/") return pathname === "/" || pathname === "/index";
  return pathname === route || pathname.startsWith(route + "/");
}

export function NavMenu() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { legs } = useBetSlip();
  const { isSignedIn } = useAuth();
  const { entitlement, requirePro } = useSubscription();
  const [open, setOpen] = useState(false);
  const [tourFocus, setTourFocus] = useState<TourMenuFocus | null>(null);
  const menuScrollRef = useRef<ScrollView>(null);
  const afterMenuDismiss = useRef<(() => void) | null>(null);
  const tourRowOffsets = useRef<Record<string, number>>({});
  useEffect(() => subscribeTourMenuFocus((focus) => {
    setTourFocus(focus);
    setOpen(!!focus);
  }), []);
  useEffect(() => {
    if (!tourFocus) return;
    // Scroll using measured row positions rather than hard-coded offsets,
    // which vary with device font size and accessibility settings.
    const id = setTimeout(() => {
      const y = tourRowOffsets.current[tourFocus.route];
      if (y !== undefined) menuScrollRef.current?.scrollTo({ y: Math.max(0, y - 130), animated: true });
    }, 120);
    return () => clearTimeout(id);
  }, [tourFocus?.route]);

  // Signed-out users always get Sign in at the bottom; signed-in keep Account.
  const account = accountMenuItem(!!isSignedIn);
  const plans = plansMenuItem();
  const showOtaDiagnostics = shouldShowOtaDiagnosticsMenuItem(__DEV__);

  const close = () => {
    if (tourFocus) tourFocus.onSkip();
    setOpen(false);
    setTourMenuFocus(null);
  };
  const toggle = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    if (open) close();
    else setOpen(true);
  };

  const go = (route: string) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    if (tourFocus) tourFocus.onSkip();
    setOpen(false);
    setTourMenuFocus(null);
    const premiumId = premiumFeatureForRoute(route);
    // Navigate into the tab; PremiumFeatureGate shows Sign In / Subscribe when locked.
    // Nudge soft paywall for signed-in free users (logged-out users get Sign In on the gate).
    if (premiumId && !entitlement.isPro && isSignedIn) {
      requirePro(PREMIUM_FEATURES[premiumId].label);
    }
    if (!isActive(pathname, route)) {
      router.navigate(route as any);
    }
  };

  const isRouteLocked = (route: string) => {
    const premiumId = premiumFeatureForRoute(route);
    return !!premiumId && !entitlement.isPro;
  };

  const panelTop = insets.top + 50;
  const panelMaxHeight = Math.max(280, Dimensions.get("window").height - panelTop - insets.bottom - 16);

  return (
    <>
      {/* Floating hamburger button — top left, over every tab screen */}
      <Pressable
        onPress={toggle}
        hitSlop={10}
        accessibilityLabel="Open navigation menu"
        accessibilityRole="button"
        style={({ pressed }) => ({
          position: "absolute",
          top: insets.top + 6,
          left: 16,
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
          zIndex: 50,
        })}
      >
        <Feather name={open ? "x" : "menu"} size={20} color={colors.foreground} />
        {SLIP_UI_ENABLED && legs.length > 0 && !open ? (
          <View
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              paddingHorizontal: 4,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: "#020617", fontFamily: FONT.bold, fontSize: 10 }}>
              {legs.length}
            </Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={close}
        onDismiss={() => {
          const next = afterMenuDismiss.current;
          afterMenuDismiss.current = null;
          next?.();
        }}
      >
        <View style={{ flex: 1 }}>
          {tourFocus ? (
            <BlurView pointerEvents="none" intensity={65} tint="dark" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          ) : null}
          <Pressable accessibilityLabel="Close navigation menu" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={close} />
          <View
            style={{
              position: "absolute",
              top: panelTop,
              left: 16,
              width: 220,
              maxHeight: panelMaxHeight,
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: 8,
              shadowColor: "#000",
              shadowOpacity: 0.4,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 12,
              overflow: "hidden",
            }}
          >
            <ScrollView
              ref={menuScrollRef}
              bounces={false}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: panelMaxHeight - 16 }}
            >
              {DESTINATIONS.map((d) => {
                const active = isActive(pathname, d.route);
                const locked = isRouteLocked(d.route);
                return (
                  <Pressable
                    key={d.route}
                    onLayout={(event) => {
                      tourRowOffsets.current[d.route] = event.nativeEvent.layout.y;
                      if (tourFocus?.route === d.route) {
                        menuScrollRef.current?.scrollTo({
                          y: Math.max(0, event.nativeEvent.layout.y - 130), animated: true,
                        });
                      }
                    }}
                    onPress={() => go(d.route)}
                    accessibilityLabel={locked ? `${d.label}, locked` : d.label}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      backgroundColor: tourFocus?.route === d.route ? "rgba(59,130,246,0.30)" : pressed ? colors.background : "transparent",
                      borderWidth: tourFocus?.route === d.route ? 3 : 0,
                      borderColor: colors.primary,
                      borderRadius: tourFocus?.route === d.route ? 10 : 0,
                    })}
                  >
                    <Feather
                      name={d.icon}
                      size={18}
                      color={tourFocus?.route === d.route || active ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={{
                        flex: 1,
                        color: tourFocus?.route === d.route ? colors.foreground : active ? colors.foreground : colors.mutedForeground,
                        fontFamily: tourFocus?.route === d.route || active ? FONT.semibold : FONT.medium,
                        fontSize: 15,
                      }}
                    >
                      {d.label}
                    </Text>
                    {d.route === "/slip" && legs.length > 0 ? (
                      <View
                        style={{
                          minWidth: 20,
                          height: 20,
                          borderRadius: 10,
                          paddingHorizontal: 6,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: colors.primary,
                        }}
                      >
                        <Text style={{ color: "#020617", fontFamily: FONT.bold, fontSize: 11 }}>
                          {legs.length}
                        </Text>
                      </View>
                    ) : locked ? (
                      <Feather name="lock" size={14} color={colors.mutedForeground} />
                    ) : active ? (
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: colors.primary,
                        }}
                      />
                    ) : null}
                  </Pressable>
                );
              })}

              {/* Account / Sign in — always last in production (OTA debug is __DEV__ only). */}
              <View
                style={{
                  height: 1,
                  backgroundColor: colors.border,
                  marginVertical: 6,
                  marginHorizontal: 12,
                }}
              />
              <Pressable
                onPress={() => go(plans.route)}
                accessibilityLabel={plans.label}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: pressed ? colors.background : "transparent",
                })}
              >
                <Feather
                  name={plans.icon}
                  size={18}
                  color={isActive(pathname, plans.route) ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={{
                    flex: 1,
                    color: isActive(pathname, plans.route)
                      ? colors.foreground
                      : colors.mutedForeground,
                    fontFamily: FONT.medium,
                    fontSize: 15,
                  }}
                >
                  {plans.label}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => go("/notifications")}
                accessibilityLabel={
                  isRouteLocked("/notifications") ? "Notifications, locked" : "Notifications"
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: pressed ? colors.background : "transparent",
                })}
              >
                <Feather
                  name="bell"
                  size={18}
                  color={
                    isActive(pathname, "/notifications") ? colors.primary : colors.mutedForeground
                  }
                />
                <Text
                  style={{
                    flex: 1,
                    color: isActive(pathname, "/notifications")
                      ? colors.foreground
                      : colors.mutedForeground,
                    fontFamily: FONT.medium,
                    fontSize: 15,
                  }}
                >
                  Notifications
                </Text>
                {isRouteLocked("/notifications") ? (
                  <Feather name="lock" size={14} color={colors.mutedForeground} />
                ) : null}
              </Pressable>
              {showOtaDiagnostics ? (
                <Pressable
                  onPress={() => go("/ota-debug")}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: pressed ? colors.background : "transparent",
                  })}
                >
                  <Feather
                    name="info"
                    size={18}
                    color={isActive(pathname, "/ota-debug") ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={{
                      flex: 1,
                      color: isActive(pathname, "/ota-debug")
                        ? colors.foreground
                        : colors.mutedForeground,
                      fontFamily: FONT.medium,
                      fontSize: 15,
                    }}
                  >
                    Device attestation
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => go(account.route)}
                accessibilityLabel={account.label}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: pressed ? colors.background : "transparent",
                })}
              >
                <Feather
                  name={account.icon}
                  size={18}
                  color={isActive(pathname, account.route) ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={{
                    flex: 1,
                    color: isActive(pathname, account.route)
                      ? colors.foreground
                      : colors.mutedForeground,
                    fontFamily: FONT.medium,
                    fontSize: 15,
                  }}
                >
                  {account.label}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
          {tourFocus ? (
            <View
              accessibilityLabel={tourFocus.step === 4 ? "Simulator tour" : "Edge Lock tour"}
              style={{
                position: "absolute", bottom: insets.bottom + 12, left: 16, right: 16,
                backgroundColor: "#101b31", borderColor: "#398bff", borderWidth: 2,
                borderRadius: 18, padding: 16, gap: 10,
              }}
            >
              <Text style={{ color: "#88a9df", fontSize: 12 }}>STADIUM EDGE TOUR · {tourFocus.step} OF 5</Text>
              <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "700" }}>
                {tourFocus.step === 4 ? "Explore the Game Simulator" : "Discover Edge Lock"}
              </Text>
              <Text style={{ color: "#d3def2", fontSize: 14, lineHeight: 20 }}>
                {tourFocus.step === 4
                  ? "Simulator is highlighted in the menu. Explore possible outcomes and estimated probabilities — not guaranteed results."
                  : "Edge Lock is highlighted in the menu. Compare model estimates with real sportsbook prices; an edge is not a guaranteed win."}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Pressable accessibilityRole="button" onPress={tourFocus.onSkip} style={{ padding: 8 }}>
                  <Text style={{ color: "#aabdd9" }}>Skip</Text>
                </Pressable>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Pressable accessibilityRole="button" onPress={() => {
                    if (tourFocus.step === 4) {
                      // The first tour modal cannot appear over the menu modal on
                      // iOS; resume step 3 only once the menu has disappeared.
                      afterMenuDismiss.current = tourFocus.onBack;
                      setTourMenuFocus(null);
                      setOpen(false);
                    } else tourFocus.onBack();
                  }} style={{ padding: 8 }}>
                    <Text style={{ color: "#ffffff" }}>Back</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={tourFocus.onNext} style={{ backgroundColor: "#347feb", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
                    <Text style={{ color: "#ffffff", fontWeight: "700" }}>{tourFocus.step === 4 ? "Next" : "Finish"}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
