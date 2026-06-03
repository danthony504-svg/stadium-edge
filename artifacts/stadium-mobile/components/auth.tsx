import { Feather } from "@expo/vector-icons";
import { useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
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

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

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

// Branded card wrapper: navy background, close button, Stadium Edge wordmark,
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
          <Text
            style={{
              fontFamily: FONT.display,
              fontSize: 13,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: colors.primary,
              marginBottom: 18,
            }}
          >
            Stadium Edge
          </Text>
          <Text
            style={{
              fontFamily: FONT.display,
              fontSize: 28,
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

export function AuthField({
  label,
  error,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; error?: string }) {
  const colors = useColors();
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
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: error ? colors.destructive : colors.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          color: colors.foreground,
          fontFamily: FONT.body,
          fontSize: 16,
        }}
        {...props}
      />
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
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: colors.primary,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 6,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryForeground} />
      ) : (
        <Text
          style={{
            fontFamily: FONT.bold,
            fontSize: 16,
            color: colors.primaryForeground,
          }}
        >
          {label}
        </Text>
      )}
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
          <Feather name="chrome" size={18} color={colors.foreground} />
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
