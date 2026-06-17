import { useAuth, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Redirect, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Share,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  clearBiometricLogin,
  getBiometricCapability,
  getSavedLoginEmail,
} from "@/lib/biometricLogin";
import { deleteAccount } from "@/lib/api";
import { buildReferralLink } from "@/lib/referral";

export default function AccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();

  const [bioLoginEmail, setBioLoginEmail] = React.useState<string | null>(null);
  const [bioCap, setBioCap] = React.useState({
    supported: false,
    label: "Face ID",
  });
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const onConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      // Server deletes the auth user (incl. linked Google/Apple logins) and all
      // stored data, then we drop saved credentials, sign out, and land on the
      // public welcome screen.
      await deleteAccount();
      await clearBiometricLogin().catch(() => {});
      await signOut();
      router.replace("/welcome");
    } catch {
      setDeleting(false);
      setDeleteError(
        "We couldn't delete your account. Check your connection and try again.",
      );
    }
  };

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

  // Only relevant when signed in; otherwise send them to sign-in.
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "Signed in";
  const initial = email.charAt(0).toUpperCase();

  // Refer-a-friend: a shareable link unique to this account, derived from the
  // real account id. We only render the card when we can build a real, openable
  // URL (id + domain) — never a code-only or placeholder fallback.
  const referralLink = buildReferralLink(user?.id, process.env.EXPO_PUBLIC_DOMAIN);
  const [copied, setCopied] = React.useState(false);

  const onCopyReferral = async () => {
    if (!referralLink) return;
    await Clipboard.setStringAsync(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const onShareReferral = async () => {
    if (!referralLink) return;
    try {
      await Share.share({
        message: `Join me on Stadium Edge for real betting edges — sign up with my link: ${referralLink}`,
      });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

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

        {referralLink ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              padding: 16,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Feather name="gift" size={18} color={colors.primary} />
              <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}>
                Refer a friend
              </Text>
            </View>
            <Text
              style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground }}
            >
              Share your personal link and invite friends to Stadium Edge.
            </Text>
            <View
              style={{
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingVertical: 10,
                paddingHorizontal: 12,
              }}
            >
              <Text
                style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.foreground }}
                numberOfLines={1}
              >
                {referralLink}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={onCopyReferral}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  paddingVertical: 11,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Feather
                  name={copied ? "check" : "copy"}
                  size={16}
                  color={copied ? colors.primary : colors.foreground}
                />
                <Text
                  style={{
                    fontFamily: FONT.semibold,
                    fontSize: 14,
                    color: copied ? colors.primary : colors.foreground,
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Text>
              </Pressable>
              <Pressable
                onPress={onShareReferral}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: colors.primary,
                  borderRadius: 10,
                  paddingVertical: 11,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Feather name="share" size={16} color={colors.primaryForeground} />
                <Text
                  style={{ fontFamily: FONT.bold, fontSize: 14, color: colors.primaryForeground }}
                >
                  Share
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

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

        <Pressable
          onPress={() => {
            setDeleteError(null);
            setConfirmDeleteOpen(true);
          }}
          hitSlop={8}
          accessibilityLabel="Delete account"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 10,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Feather name="trash-2" size={15} color={colors.mutedForeground} />
          <Text
            style={{
              fontFamily: FONT.semibold,
              fontSize: 13,
              color: colors.mutedForeground,
            }}
          >
            Delete account
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={confirmDeleteOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.72)",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 420,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              padding: 22,
              gap: 14,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.destructive,
                }}
              >
                <Feather name="alert-triangle" size={22} color={colors.destructive} />
              </View>
              <Text
                style={{
                  fontFamily: FONT.display,
                  fontSize: 20,
                  color: colors.foreground,
                  flex: 1,
                }}
              >
                Delete your account?
              </Text>
            </View>

            <Text
              style={{
                fontFamily: FONT.body,
                fontSize: 14,
                lineHeight: 21,
                color: colors.mutedForeground,
              }}
            >
              This permanently deletes your Stadium Edge account and all of your
              data — saved slips, pick tracker, results and preferences. It
              applies to email, Google and Apple sign-ins.
            </Text>
            <Text
              style={{
                fontFamily: FONT.semibold,
                fontSize: 14,
                lineHeight: 21,
                color: colors.foreground,
              }}
            >
              This can't be undone.
            </Text>

            {deleteError ? (
              <Text
                style={{
                  fontFamily: FONT.medium,
                  fontSize: 13,
                  color: colors.destructive,
                }}
              >
                {deleteError}
              </Text>
            ) : null}

            <View style={{ gap: 10, marginTop: 4 }}>
              <Pressable
                onPress={onConfirmDelete}
                disabled={deleting}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  backgroundColor: colors.destructive,
                  borderRadius: 12,
                  paddingVertical: 14,
                  opacity: deleting ? 0.7 : pressed ? 0.85 : 1,
                })}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Feather name="trash-2" size={17} color="#ffffff" />
                )}
                <Text
                  style={{ fontFamily: FONT.bold, fontSize: 15, color: "#ffffff" }}
                >
                  {deleting ? "Deleting…" : "Permanently delete"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
                style={({ pressed }) => ({
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingVertical: 14,
                  opacity: deleting ? 0.5 : pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: FONT.semibold,
                    fontSize: 15,
                    color: colors.foreground,
                  }}
                >
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
