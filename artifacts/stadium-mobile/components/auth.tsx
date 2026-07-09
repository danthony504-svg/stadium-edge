import { useClerk, useSSO } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { Feather } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
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
// privacy-focused login option whenever third-party/social sign-in is offered.
// iOS uses native Sign in with Apple (oauth_token_apple); other platforms use
// Clerk's browser SSO (oauth_apple). Apple must be enabled in the Clerk Auth pane.
function describeSsoError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      errors?: Array<{ code?: string; message?: string; longMessage?: string }>;
      message?: string;
    };
    const first = e.errors?.[0];
    if (first) {
      const parts = [first.longMessage || first.message, first.code]
        .filter(Boolean)
        .join(" ");
      if (parts) return parts;
    }
    if (typeof e.message === "string" && e.message) return e.message;
  }
  return "Unknown error";
}

const APPLE_STRATEGY_UNAVAILABLE =
  /oauth_apple|oauth_token_apple|form_param_value_invalid|allowed values for parameter strategy/i;

/** Never surface raw Clerk strategy codes to users — map to actionable copy. */
function friendlyAppleSignInError(detail: string): string {
  if (APPLE_STRATEGY_UNAVAILABLE.test(detail)) {
    return Platform.OS === "ios"
      ? "Sign in with Apple is not available in this build yet. Use email and password below, or install the latest TestFlight update when it is available."
      : "Sign in with Apple is only available on iPhone. Use email and password instead.";
  }
  if (/provider|not enabled|connection/i.test(detail)) {
    return "Sign in with Apple is not configured yet. Use email and password for now.";
  }
  return `Apple sign-in failed. Try email and password, or contact support if this keeps happening.`;
}

function clerkSupportsAppleSignIn(
  client: ReturnType<typeof useClerk>["client"],
  platform: "ios" | "android" | "web" | "windows" | "macos",
): boolean | null {
  const factors =
    (client as { authConfig?: { firstFactors?: Array<{ strategy?: string }> } } | null | undefined)
      ?.authConfig?.firstFactors;
  if (!factors?.length) return null;
  const wanted = platform === "ios" ? "oauth_token_apple" : "oauth_apple";
  return factors.some((f) => f.strategy === wanted || f.strategy === "oauth_apple");
}

export function AppleAuthButton() {
  useWarmUpBrowser();
  const router = useRouter();
  const { client } = useClerk();
  const { startSSOFlow } = useSSO();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appleSupported =
    client == null ? null : clerkSupportsAppleSignIn(client, Platform.OS);

  const finishSession = useCallback(
    async (createdSessionId: string | null | undefined, setActive: ((...args: any[]) => Promise<void>) | undefined) => {
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: async ({ session, decorateUrl }: { session?: { currentTask?: unknown }; decorateUrl: (path: string) => string }) => {
            if (session?.currentTask) return;
            router.replace(decorateUrl("/") as Href);
          },
        });
      }
    },
    [router],
  );

  const onPress = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (Platform.OS === "ios") {
        // Native Sign in with Apple — browser oauth_apple is rejected on iOS
        // (form_param_value_invalid) and does not meet App Store 4.8 expectations.
        const nativeAvailable = await AppleAuthentication.isAvailableAsync();
        if (!nativeAvailable) {
          setError(
            "Sign in with Apple needs the latest Stadium Edge build. Update from TestFlight or the App Store, then try again.",
          );
          return;
        }
        const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
        await finishSession(createdSessionId, setActive);
      } else {
        const { createdSessionId, setActive } = await startSSOFlow({
          strategy: "oauth_apple",
          redirectUrl: AuthSession.makeRedirectUri(),
        });
        await finishSession(createdSessionId, setActive);
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "ERR_REQUEST_CANCELED" || e.code === "ERR_CANCELED") return;
      if (typeof e.message === "string" && e.message.includes("ERR_REQUEST_CANCELED")) return;
      const detail = describeSsoError(err);
      let raw = "";
      try {
        raw = JSON.stringify(err, null, 2);
      } catch {
        raw = String(err);
      }
      console.error("Apple SSO failed:", detail, raw);
      setError(friendlyAppleSignInError(detail));
    } finally {
      setBusy(false);
    }
  }, [busy, finishSession, startAppleAuthenticationFlow, startSSOFlow]);

  if (appleSupported === false) {
    return null;
  }

  return (
    <View style={{ gap: 8 }}>
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
      {error ? (
        <Text
          style={{
            fontFamily: FONT.medium,
            fontSize: 13,
            color: "#fca5a5",
            textAlign: "center",
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

