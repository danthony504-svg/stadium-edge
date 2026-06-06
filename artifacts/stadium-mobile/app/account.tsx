import { useAuth, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import React from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useAppLock } from "@/context/AppLockContext";
import { useColors } from "@/hooks/useColors";
import {
  clearBiometricLogin,
  getBiometricCapability,
  getSavedLoginEmail,
} from "@/lib/biometricLogin";

export default function AccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const {
    enabled: lockEnabled,
    supported: lockSupported,
    biometricLabel,
    setEnabled: setLockEnabled,
  } = useAppLock();

  const [bioLoginEmail, setBioLoginEmail] = React.useState<string | null>(null);
  const [bioCap, setBioCap] = React.useState({
    supported: false,
    label: "Face ID",
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cap, savedEmail] = await Promise.all([
        getBiometricCapability(),
        getSavedLoginEmail(),
      ]);
      if (cancelled) return;
      setBioCap(cap);
      setBioLoginEmail(savedEmail);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggleBioLogin = async (next: boolean) => {
    if (!next) {
      await clearBiometricLogin();
      setBioLoginEmail(null);
      return;
    }
    // We can only store credentials at sign-in time (the password isn't
    // available while already signed in), so guide the user there.
    Alert.alert(
      `Turn on ${bioCap.label} sign-in`,
      `Sign out, then sign back in once with your password — we'll offer to remember it for ${bioCap.label}.`,
    );
  };

  const onToggleLock = async (next: boolean) => {
    if (next && !lockSupported) {
      Alert.alert(
        `${biometricLabel} unavailable`,
        "Set up Face ID or Touch ID in your device Settings, then try again.",
      );
      return;
    }
    const ok = await setLockEnabled(next);
    if (next && !ok) {
      Alert.alert(
        "Couldn't turn on lock",
        `We couldn't confirm your ${biometricLabel}. Please try again.`,
      );
    }
  };

  // Only relevant when signed in; otherwise send them to sign-in.
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "Signed in";
  const initial = email.charAt(0).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 20,
          paddingBottom: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontFamily: FONT.display, fontSize: 24, color: colors.foreground }}>
          Account
        </Text>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={12}
          accessibilityLabel="Close"
          style={{
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
      </View>

      <View style={{ paddingHorizontal: 20, gap: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            padding: 16,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{ fontFamily: FONT.bold, fontSize: 22, color: colors.primaryForeground }}
            >
              {initial}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontFamily: FONT.semibold, fontSize: 16, color: colors.foreground }}
              numberOfLines={1}
            >
              {email}
            </Text>
            <Text
              style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, marginTop: 2 }}
            >
              Your slips sync across devices
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            padding: 16,
          }}
        >
          <Feather name="refresh-cw" size={18} color={colors.primary} />
          <Text
            style={{ flex: 1, fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground }}
          >
            Saved slips are backed up to your account and restored automatically when you
            sign in on another device.
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            padding: 16,
          }}
        >
          <Feather name="lock" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}
            >
              Require {biometricLabel} to unlock
            </Text>
            <Text
              style={{
                fontFamily: FONT.body,
                fontSize: 13,
                color: colors.mutedForeground,
                marginTop: 2,
              }}
            >
              {lockSupported
                ? `Ask for ${biometricLabel} every time you open Stadium Edge.`
                : "Set up Face ID or Touch ID on your device to use this."}
            </Text>
          </View>
          <Switch
            value={lockEnabled}
            onValueChange={onToggleLock}
            disabled={!lockSupported}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#ffffff"
            ios_backgroundColor={colors.border}
          />
        </View>

        {bioCap.supported || bioLoginEmail ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              padding: 16,
            }}
          >
            <Feather name="user-check" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}
              >
                Sign in with {bioCap.label}
              </Text>
              <Text
                style={{
                  fontFamily: FONT.body,
                  fontSize: 13,
                  color: colors.mutedForeground,
                  marginTop: 2,
                }}
                numberOfLines={2}
              >
                {bioLoginEmail
                  ? `On — tap ${bioCap.label} on the sign-in screen instead of typing your password.`
                  : `Use ${bioCap.label} to sign in without typing your password.`}
              </Text>
            </View>
            <Switch
              value={!!bioLoginEmail}
              onValueChange={onToggleBioLogin}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#ffffff"
              ios_backgroundColor={colors.border}
            />
          </View>
        ) : null}

        <Pressable
          onPress={async () => {
            await signOut();
            router.replace("/");
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: colors.destructive,
            borderRadius: 12,
            paddingVertical: 14,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: colors.destructive }}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
