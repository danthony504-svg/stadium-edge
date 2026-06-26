import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const DESTINATIONS: { label: string; route: string; icon: FeatherName }[] = [
  { label: "Home", route: "/", icon: "home" },
  { label: "Coach", route: "/coach", icon: "zap" },
  { label: "Park Weather", route: "/weather", icon: "cloud-drizzle" },
  { label: "Props", route: "/props", icon: "user" },
  { label: "Edge Lock", route: "/arbitrage", icon: "repeat" },
  { label: "+500 Steals", route: "/steals", icon: "target" },
  { label: "Slip", route: "/slip", icon: "layers" },
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
  const [open, setOpen] = useState(false);

  const accountRoute = isSignedIn ? "/account" : "/sign-in";
  const accountLabel = isSignedIn ? "Account" : "Sign in";
  const accountIcon: FeatherName = isSignedIn ? "user-check" : "log-in";

  const toggle = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setOpen((v) => !v);
  };

  const go = (route: string) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setOpen(false);
    if (!isActive(pathname, route)) {
      router.navigate(route as any);
    }
  };

  const panelTop = insets.top + 50;

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
        {legs.length > 0 && !open ? (
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

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            style={{
              position: "absolute",
              top: panelTop,
              left: 16,
              width: 220,
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
            }}
          >
            {DESTINATIONS.map((d) => {
              const active = isActive(pathname, d.route);
              return (
                <Pressable
                  key={d.route}
                  onPress={() => go(d.route)}
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
                    name={d.icon}
                    size={18}
                    color={active ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={{
                      flex: 1,
                      color: active ? colors.foreground : colors.mutedForeground,
                      fontFamily: active ? FONT.semibold : FONT.medium,
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

            {/* Account / sign-in — auth is optional, shown at the bottom */}
            <View
              style={{
                height: 1,
                backgroundColor: colors.border,
                marginVertical: 6,
                marginHorizontal: 12,
              }}
            />
            {isSignedIn ? (
              <Pressable
                onPress={() => go("/notifications")}
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
                  color={isActive(pathname, "/notifications") ? colors.primary : colors.mutedForeground}
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
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => go(accountRoute)}
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
                name={accountIcon}
                size={18}
                color={isActive(pathname, accountRoute) ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={{
                  flex: 1,
                  color: isActive(pathname, accountRoute)
                    ? colors.foreground
                    : colors.mutedForeground,
                  fontFamily: FONT.medium,
                  fontSize: 15,
                }}
              >
                {accountLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
