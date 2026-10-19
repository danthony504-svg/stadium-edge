import { useAuth } from "@clerk/expo";
import { useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { FONT } from "@/components/ui";
import { APP_STORE_INVITE_URL, normalizeReferralCode } from "@/lib/referral";
import {
  applyReferral,
  claimReferralReward,
  clearPendingInvite,
  getReferralStatus,
  loadPendingInvite,
  ReferralRequestError,
  type ReferralStatus,
} from "@/lib/referralApi";

export function ReferralCard() {
  const colors = useColors();
  const { userId } = useAuth();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const active = useRef(false);
  const owner = useRef(userId);
  owner.current = userId;
  const busyRef = useRef(false);
  const refresh = useCallback(async () => {
    const current = userId;
    try {
      const data = await getReferralStatus(userId ?? "");
      if (!active.current || owner.current !== current) return;
      setStatus(data);
      const pending = await loadPendingInvite();
      if (!active.current || owner.current !== current) return;
      if (pending && !busyRef.current) {
        if (!data.canApplyInvite) {
          await clearPendingInvite();
          setNotice("Invites apply only to new accounts within 7 days.");
          return;
        }
        busyRef.current = true;
        try {
          await applyReferral(userId ?? "", pending.code);
          await clearPendingInvite();
          if (active.current && owner.current === current)
            setNotice("Invite applied. Your friend received credit.");
        } catch (e) {
          if (
            e instanceof ReferralRequestError &&
            [400, 404, 409].includes(e.status)
          )
            await clearPendingInvite();
          if (active.current && owner.current === current)
            setNotice(
              e instanceof Error
                ? e.message
                : "Couldn't apply this invite. Try again.",
            );
        } finally {
          busyRef.current = false;
        }
      }
    } catch (e) {
      if (active.current && owner.current === current) {
        setStatus(null);
        setNotice(
          e instanceof Error ? e.message : "Referral rewards are unavailable.",
        );
      }
    } finally {
      if (active.current && owner.current === current) setLoading(false);
    }
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      setStatus(null);
      setNotice("");
      setLoading(true);
      setCode("");
      setCopied(false);
      void refresh();
      return () => {
        active.current = false;
      };
    }, [refresh]),
  );
  const action = async (run: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const current = userId;
    try {
      await run();
    } catch (e) {
      if (active.current && owner.current === current)
        setNotice(e instanceof Error ? e.message : "Please try again later.");
    } finally {
      busyRef.current = false;
      if (active.current && owner.current === current) setBusy(false);
    }
  };
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: colors.primary,
        opacity: disabled ? 0.5 : 1,
        padding: 12,
        borderRadius: 10,
      }}
    >
      <Text
        style={{
          color: colors.primaryForeground,
          fontFamily: FONT.bold,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const link = status?.link ?? APP_STORE_INVITE_URL;
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
      }}
    >
      <Text
        style={{
          fontFamily: FONT.semibold,
          fontSize: 16,
          color: colors.foreground,
        }}
      >
        Refer a friend
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : status ? (
        <>
          <Text style={{ color: colors.foreground }}>
            {status.verifiedFriends} verified new friend
            {status.verifiedFriends === 1 ? "" : "s"} joined
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            Invite 3 friends for 1 free week, or reach 10 for 1 free month. Each
            milestone is earned once. Share taps do not count.
          </Text>
          <Text selectable style={{ color: colors.foreground }}>
            Your invite code: {status.code}
          </Text>
          {status.milestones.map((m) => (
            <View key={m.count} style={{ gap: 8 }}>
              <Text style={{ color: colors.mutedForeground }}>
                {Math.min(status.verifiedFriends, m.count)}/{m.count} ·{" "}
                {m.label}
              </Text>
              {status.verifiedFriends >= m.count
                ? button(
                    m.claimed ? `Redeem ${m.label}` : `Claim ${m.label}`,
                    () =>
                      void action(async () => {
                        const reward = await claimReferralReward(
                          userId ?? "",
                          m.count,
                        );
                        if (!active.current || owner.current !== userId) return;
                        const url = new URL(reward.redemptionUrl);
                        if (
                          url.origin !== "https://apps.apple.com" ||
                          url.pathname !== "/redeem" ||
                          url.searchParams.get("id") !== "6776024127"
                        )
                          throw new Error(
                            "Invalid reward link. Contact support.",
                          );
                        setStatus((s) =>
                          s
                            ? {
                                ...s,
                                milestones: s.milestones.map((x) =>
                                  x.count === m.count
                                    ? { ...x, claimed: true }
                                    : x,
                                ),
                              }
                            : s,
                        );
                        await Linking.openURL(reward.redemptionUrl);
                      }),
                    busy,
                  )
                : null}
            </View>
          ))}
          <Text style={{ color: colors.mutedForeground }}>
            Apple shows eligibility and renewal terms before redemption. Your
            paid subscription is unchanged until Apple applies the offer. After
            redeeming, restore purchases from Manage plan if access hasn't
            refreshed.
          </Text>
          {status.canApplyInvite ? (
            <>
              <TextInput
                accessibilityLabel="Friend's invite code"
                placeholder="Friend's invite code"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={24}
                value={code}
                onChangeText={setCode}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  padding: 12,
                  color: colors.foreground,
                }}
              />
              {button(
                "Apply invite",
                () =>
                  void action(async () => {
                    const normalized = normalizeReferralCode(code);
                    if (!normalized)
                      throw new Error("Enter a valid invite code.");
                    await applyReferral(userId ?? "", normalized);
                    await clearPendingInvite();
                    if (active.current && owner.current === userId) {
                      setCode("");
                      setNotice("Invite applied. Your friend received credit.");
                    }
                  }),
                busy || !normalizeReferralCode(code),
              )}
            </>
          ) : null}
        </>
      ) : (
        <Text style={{ color: colors.mutedForeground }}>
          Rewards are unavailable right now. You can still share the App Store
          download link.
        </Text>
      )}
      {notice ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.mutedForeground }}
        >
          {notice}
        </Text>
      ) : null}
      {!loading && !status
        ? button(
            "Retry referrals",
            () => {
              setLoading(true);
              void refresh();
            },
            busy,
          )
        : null}
      <Text
        selectable
        numberOfLines={2}
        style={{ color: colors.mutedForeground }}
      >
        {link}
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          {button(
            copied ? "Copied" : "Copy",
            () =>
              void action(async () => {
                await Clipboard.setStringAsync(link);
                if (active.current) setCopied(true);
              }),
            busy,
          )}
        </View>
        <View style={{ flex: 1 }}>
          {button(
            "Share",
            () =>
              void action(async () => {
                await Share.share({
                  message: status
                    ? `Join me on Stadium Edge: ${link}\nI may earn free access if you join using my invite. New accounts: verify your email and apply code ${status.code} within 7 days.`
                    : `Try Stadium Edge: ${link}`,
                });
              }),
            busy,
          )}
        </View>
      </View>
    </View>
  );
}
