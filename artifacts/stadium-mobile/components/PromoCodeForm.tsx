import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { FONT } from "@/components/ui";
import { useSubscription } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";

type PromoCodeFormProps = {
  /** Auto-filled from ?promo= deep link. */
  initialCode?: string | null;
  autoRedeem?: boolean;
};

export function PromoCodeForm({ initialCode, autoRedeem }: PromoCodeFormProps) {
  const colors = useColors();
  const { redeemPromo, entitlement } = useSubscription();
  const [code, setCode] = React.useState(initialCode ?? "");
  const [message, setMessage] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<boolean | null>(null);
  const autoDone = React.useRef(false);

  React.useEffect(() => {
    if (initialCode) setCode(initialCode);
  }, [initialCode]);

  const onRedeem = React.useCallback(
    (raw?: string) => {
      const result = redeemPromo(raw ?? code);
      setOk(result.ok);
      setMessage(result.message);
    },
    [code, redeemPromo],
  );

  React.useEffect(() => {
    if (!autoRedeem || !initialCode || autoDone.current) return;
    autoDone.current = true;
    onRedeem(initialCode);
  }, [autoRedeem, initialCode, onRedeem]);

  return (
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
          Promo code
        </Text>
      </View>
      <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, lineHeight: 18 }}>
        Have a free unlock code or link? Enter it here. Links look like{" "}
        <Text style={{ fontFamily: FONT.medium, color: colors.foreground }}>
          …/plans?promo=EDGE7
        </Text>
        .
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <TextInput
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="e.g. EDGE7"
          placeholderTextColor={colors.mutedForeground}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 11,
            color: colors.foreground,
            fontFamily: FONT.medium,
            fontSize: 14,
            backgroundColor: colors.background,
          }}
        />
        <Pressable
          onPress={() => onRedeem()}
          style={({ pressed }) => ({
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 16,
            borderRadius: 10,
            backgroundColor: colors.primary,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: colors.primaryForeground }}>
            Redeem
          </Text>
        </Pressable>
      </View>
      {message ? (
        <Text
          style={{
            fontFamily: FONT.medium,
            fontSize: 13,
            color: ok ? colors.success : colors.destructive,
          }}
        >
          {ok ? `Unlocked: ${message}` : message}
        </Text>
      ) : null}
      {entitlement.unlockSource === "promo" && entitlement.redeemedPromoCode ? (
        <Text style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}>
          Active code: {entitlement.redeemedPromoCode}
        </Text>
      ) : null}
    </View>
  );
}
