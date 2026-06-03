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

// Multicolor Google "G" mark.
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Svg>
  );
}

// Google SSO button. startSSOFlow signs up AND signs in, so a single button
// covers both flows. On success it sets the active session and returns home.
export function GoogleAuthButton() {
  useWarmUpBrowser();
  const colors = useColors();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
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
      console.error("Google SSO failed", JSON.stringify(err, null, 2));
    } finally {
      setBusy(false);
    }
  }, [busy, router, startSSOFlow]);

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingVertical: 13,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.foreground} />
      ) : (
        <>
          <GoogleG size={18} />
          <Text
            style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}
          >
            Continue with Google
          </Text>
        </>
      )}
    </Pressable>
  );
}
