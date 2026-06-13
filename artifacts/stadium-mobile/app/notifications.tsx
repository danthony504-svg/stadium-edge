import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  getPermissionStatus,
  getPrefs,
  putPrefs,
  registerForPushAsync,
  sendTestPush,
  type NotifPrefs,
} from "@/lib/notifications";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const DEFAULT_PREFS: NotifPrefs = {
  master: true,
  dailyPicks: true,
  betResults: true,
  oddsMovement: true,
  gameReminders: true,
  upsetAlerts: true,
  coachReady: true,
};

type CategoryKey = keyof Omit<NotifPrefs, "master">;

const CATEGORIES: { key: CategoryKey; icon: FeatherName; title: string; subtitle: string }[] = [
  {
    key: "gameReminders",
    icon: "clock",
    title: "Game reminders",
    subtitle: "A heads-up before a game on your saved slips tips off.",
  },
  {
    key: "betResults",
    icon: "check-circle",
    title: "Bet results",
    subtitle: "Know when every game on a saved slip has gone final.",
  },
  {
    key: "dailyPicks",
    icon: "zap",
    title: "Daily AI picks",
    subtitle: "A once-a-day nudge when fresh Coach picks are ready.",
  },
  {
    key: "oddsMovement",
    icon: "trending-up",
    title: "Line movement",
    subtitle: "Big odds swings on games in your saved slips.",
  },
  {
    key: "upsetAlerts",
    icon: "target",
    title: "Underdog watch",
    subtitle: "A daily heads-up when our model likes a live underdog.",
  },
  {
    key: "coachReady",
    icon: "message-circle",
    title: "Coach parlay ready",
    subtitle: "When the AI Coach finishes a parlay you stepped away from.",
  },
];

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();

  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [granted, setGranted] = useState(true);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Ensure a token is registered + permission is requested when the screen
      // opens (so prefs the user sets actually have a device to deliver to).
      registerForPushAsync().catch(() => {});
      try {
        const status = await getPermissionStatus();
        if (!cancelled) setGranted(status === "granted");
      } catch {
        // ignore — assume granted so we don't show a false denial hint
      }
      try {
        const p = await getPrefs();
        if (!cancelled) setPrefs(p);
      } catch {
        // keep defaults on a failed read
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistically flip the toggle, then persist. On failure revert.
  const update = useCallback(
    (patch: Partial<NotifPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        putPrefs(patch).catch(() => {
          // Revert the optimistic change if the server rejected it.
          setPrefs(prev);
          Alert.alert("Couldn't save", "Your change didn't go through. Please try again.");
        });
        return next;
      });
    },
    [],
  );

  const onTest = useCallback(async () => {
    setTesting(true);
    try {
      const res = await sendTestPush();
      if (res.sent > 0) {
        Alert.alert("Test sent", `Sent to ${res.sent} device${res.sent === 1 ? "" : "s"}.`);
      } else {
        Alert.alert(
          "No devices",
          "This device isn't registered for push yet. Make sure notifications are enabled, then try again.",
        );
      }
    } catch {
      Alert.alert("Couldn't send", "The test notification failed. Please try again.");
    } finally {
      setTesting(false);
    }
  }, []);

  // Notification prefs are per-account; require sign-in.
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const masterOn = prefs.master;

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
          Notifications
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

      {loading ? (
        <View style={{ paddingTop: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          {!granted ? (
            <Pressable
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.destructive,
                borderRadius: colors.radius,
                padding: 16,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Feather name="alert-triangle" size={18} color={colors.destructive} />
              <Text
                style={{ flex: 1, fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground }}
              >
                Notifications are turned off for Stadium Edge. Tap to open Settings and enable
                them.
              </Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : null}

          {/* Master switch */}
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
            <Feather name="bell" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}>
                Push notifications
              </Text>
              <Text
                style={{
                  fontFamily: FONT.body,
                  fontSize: 13,
                  color: colors.mutedForeground,
                  marginTop: 2,
                }}
              >
                Turn everything on or off at once.
              </Text>
            </View>
            <Switch
              value={masterOn}
              onValueChange={(v) => update({ master: v })}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#ffffff"
              ios_backgroundColor={colors.border}
            />
          </View>

          {/* Per-category switches */}
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              overflow: "hidden",
            }}
          >
            {CATEGORIES.map((c, i) => (
              <View
                key={c.key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  opacity: masterOn ? 1 : 0.45,
                }}
              >
                <Feather name={c.icon} size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}
                  >
                    {c.title}
                  </Text>
                  <Text
                    style={{
                      fontFamily: FONT.body,
                      fontSize: 13,
                      color: colors.mutedForeground,
                      marginTop: 2,
                    }}
                  >
                    {c.subtitle}
                  </Text>
                </View>
                <Switch
                  value={prefs[c.key]}
                  disabled={!masterOn}
                  onValueChange={(v) => update({ [c.key]: v } as Partial<NotifPrefs>)}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#ffffff"
                  ios_backgroundColor={colors.border}
                />
              </View>
            ))}
          </View>

          <Pressable
            onPress={onTest}
            disabled={testing}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              borderRadius: 12,
              paddingVertical: 14,
              opacity: testing ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            {testing ? (
              <ActivityIndicator color={colors.foreground} size="small" />
            ) : (
              <Feather name="send" size={18} color={colors.foreground} />
            )}
            <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: colors.foreground }}>
              Send test notification
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
