import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Image, Pressable, View, type ImageStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const LOGO_SOURCE = require("@/assets/images/logo.png");
const LOGO_WIDTH = 150;
const LOGO_HEIGHT = 42;

/** Compact Stadium Edge logo used in the top app bar. */
export function BrandLogo({ style }: { style?: ImageStyle }) {
  return (
    <Image
      source={LOGO_SOURCE}
      style={[{ width: LOGO_WIDTH, height: LOGO_HEIGHT }, style]}
      resizeMode="contain"
      fadeDuration={0}
      accessibilityLabel="Stadium Edge"
    />
  );
}

export function HeaderBell() {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn } = useAuth();

  return (
    <Pressable
      onPress={() => router.push(isSignedIn ? "/notifications" : "/sign-in")}
      hitSlop={8}
      accessibilityLabel={isSignedIn ? "Notifications" : "Sign in"}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name="bell" size={17} color={colors.foreground} />
    </Pressable>
  );
}

type AppHeaderProps = {
  /** Extra content between the logo and the bell (e.g. page wordmark). */
  right?: React.ReactNode;
  /** Render the alerts bell on the right. Defaults to true. */
  showBell?: boolean;
  /** Page title / subtitle block rendered below the logo row. */
  children?: React.ReactNode;
  style?: ViewStyle;
  /** Bottom margin after the logo row when there are no children. */
  bottomGap?: number;
};

/**
 * Shared top bar — compact logo cleared of the floating NavMenu hamburger,
 * optional right slot, and notifications bell. Pin as a sibling above ScrollView
 * so it stays fixed while content scrolls underneath.
 */
export function AppHeader({
  right,
  showBell = true,
  children,
  style,
  bottomGap = 14,
}: AppHeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[{ paddingTop: insets.top + 6, backgroundColor: colors.background }, style]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 60,
          paddingRight: 16,
          marginBottom: children ? 0 : bottomGap,
        }}
      >
        <BrandLogo />
        <View style={{ flex: 1 }} />
        {right}
        {showBell ? <HeaderBell /> : null}
      </View>
      {children}
    </View>
  );
}
