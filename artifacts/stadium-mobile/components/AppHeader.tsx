import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Image, Pressable, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { REQUIRE_AUTH_FOR_APP } from "@/lib/authFlags";

const WORDMARK = require("@/assets/images/logo-wordmark.png");

export function HeaderBell({ style }: { style?: ViewStyle }) {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn } = useAuth();

  if (!REQUIRE_AUTH_FOR_APP && !isSignedIn) return null;

  return (
    <Pressable
      onPress={() => router.push(isSignedIn ? "/notifications" : "/sign-in")}
      hitSlop={8}
      accessibilityLabel={isSignedIn ? "Notifications" : "Sign in"}
      accessibilityRole="button"
      style={({ pressed }) => ({
        position: "absolute",
        right: 16,
        top: 3,
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
        ...(style as object),
      })}
    >
      <Feather name="bell" size={17} color={colors.foreground} />
    </Pressable>
  );
}

type AppHeaderProps = {
  children?: React.ReactNode;
  style?: ViewStyle;
  bottomGap?: number;
  showBell?: boolean;
};

/** Shared wordmark header — matches Home / Props / Steals restored layout. */
export function AppHeader({
  children,
  style,
  bottomGap = 14,
  showBell = true,
}: AppHeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        { paddingTop: insets.top + 6, backgroundColor: colors.background },
        style,
      ]}
    >
      <View
        style={{
          paddingLeft: 78,
          paddingRight: 58,
          marginBottom: children ? 0 : bottomGap,
          alignItems: "flex-start",
        }}
      >
        <Image
          source={WORDMARK}
          style={{ width: "78%", maxWidth: 280, height: 44 }}
          resizeMode="contain"
          fadeDuration={0}
          accessibilityLabel="Stadium Edge"
        />
        {showBell ? <HeaderBell /> : null}
      </View>
      {children}
    </View>
  );
}

/** Title row under the wordmark (Coach, Weather, etc.). */
export function PageTitleRow({
  icon,
  iconBg = "rgba(59,130,246,0.18)",
  title,
  subtitle,
  onHowItWorks,
  showHowItWorks = true,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  iconBg?: string;
  title: string;
  subtitle: string;
  onHowItWorks?: () => void;
  showHowItWorks?: boolean;
}) {
  const colors = useColors();
  const router = useRouter();

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12, marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: iconBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name={icon} size={19} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: FONT.display,
              fontSize: 20,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.body,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        </View>
        {showHowItWorks ? (
          <Pressable
            onPress={onHowItWorks ?? (() => router.push("/coach"))}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.primary,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={{
                color: colors.primary,
                fontFamily: FONT.medium,
                fontSize: 12,
              }}
            >
              How it works
            </Text>
            <Feather name="info" size={13} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
