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
  { label: "Props", route: "/props", icon: "user" },
  { label: "Slip", route: "/slip", icon: "layers" },
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
  const [open, setOpen] = useState(false);

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
      {/* Floating hamburger button — top right, over every tab screen */}
      <Pressable
        onPress={toggle}
        hitSlop={10}
        accessibilityLabel="Open navigation menu"
        accessibilityRole="button"
        style={({ pressed }) => ({
          position: "absolute",
          top: insets.top + 6,
          right: 16,
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
              right: 16,
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
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
