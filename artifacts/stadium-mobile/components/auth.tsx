import { useSSO } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

// Blue accent used across the auth screens to match the "Welcome back" mockup.
export const AUTH_ACCENT = "#3b82f6";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

// Required so the OAuth redirect can complete the in-app browser session.
WebBrowser.maybeCompleteAuthSession();

// Preloads the browser on Android to cut OAuth load time.
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

// Branded card wrapper: navy background, close button, Stadium Edge logo,
// title + subtitle. Used by both sign-in and sign-up so they feel native.
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 24,
          justifyContent: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={12}
          accessibilityLabel="Close"
          style={{
            position: "absolute",
            top: insets.top + 12,
            right: 20,
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>

        <View style={{ alignItems: "center", marginBottom: 28 }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: 232, height: 100, marginBottom: 14 }}
            contentFit="contain"
          />
          <Text
            style={{
              fontFamily: FONT.display,
              fontSize: 30,
              color: colors.foreground,
              textAlign: "center",
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 15,
              color: colors.mutedForeground,
              textAlign: "center",
              marginTop: 8,
              lineHeight: 21,
            }}
          >
            {subtitle}
          </Text>
        </View>

        {children}
      </ScrollView>
    </View>
  );
}

// Labeled input with an optional left icon. When `secureTextEntry` is set it
// renders an eye toggle to show/hide the password.
export function AuthField({
  label,
  error,
  leftIcon,
  secureTextEntry,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  leftIcon?: FeatherName;
}) {
  const colors = useColors();
  const [hidden, setHidden] = useState(true);
  const isSecure = !!secureTextEntry;

  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          fontFamily: FONT.medium,
          fontSize: 13,
          color: colors.mutedForeground,
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: error ? colors.destructive : colors.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: Platform.OS === "ios" ? 13 : 9,
        }}
      >
        {leftIcon ? (
          <Feather
            name={leftIcon}
            size={18}
            color={AUTH_ACCENT}
            style={{ marginRight: 10 }}
          />
        ) : null}
        <TextInput
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={isSecure ? hidden : false}
          style={{
            flex: 1,
            padding: 0,
            color: colors.foreground,
            fontFamily: FONT.body,
            fontSize: 16,
          }}
          {...props}
        />
        {isSecure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
          >
            <Feather name={hidden ? "eye" : "eye-off"} size={18} color={AUTH_ACCENT} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text
          style={{
            fontFamily: FONT.body,
            fontSize: 12,
            color: colors.destructive,
            marginTop: 5,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        borderRadius: 12,
        overflow: "hidden",
        marginTop: 6,
        opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
      })}
    >
      <LinearGradient
        colors={[AUTH_ACCENT, AUTH_ACCENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingVertical: 15,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loading ? (
          <ActivityIndicator color="#0a1020" />
        ) : (
          <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: "#0a1020" }}>
            {label}
          </Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function AuthDivider() {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginVertical: 18,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text
        style={{ fontFamily: FONT.medium, fontSize: 12, color: colors.mutedForeground }}
      >
        OR
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

// Apple logo glyph (solid). Rendered black on the white Apple-branded button.
function AppleLogo({ size = 18, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 384 512">
      <Path
        fill={color}
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </Svg>
  );
}

// Sign in with Apple button. Required by App Store Guideline 4.8 as an equivalent
// privacy-focused login option whenever third-party/social sign-in is offered. Uses Clerk's
// oauth_apple SSO flow (startSSOFlow signs up AND signs in). Styled per Apple's
// button guidelines: a white button with the black Apple glyph stands out on the
// dark auth UI (white is an Apple-approved style for dark backgrounds).
export function AppleAuthButton() {
  useWarmUpBrowser();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_apple",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: async ({ session, decorateUrl }) => {
            if (session?.currentTask) return;
            router.replace(decorateUrl("/") as Href);
          },
        });
      }
    } catch (err) {
      console.error("Apple SSO failed", JSON.stringify(err, null, 2));
    } finally {
      setBusy(false);
    }
  }, [busy, router, startSSOFlow]);

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        backgroundColor: "#ffffff",
        borderRadius: 12,
        paddingVertical: 15,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color="#000" />
      ) : (
        <>
          <AppleLogo size={18} color="#000" />
          <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: "#000" }}>
            Continue with Apple
          </Text>
        </>
      )}
    </Pressable>
  );
}

