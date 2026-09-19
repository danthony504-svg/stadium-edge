import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

type SoftPaywallModalProps = {
  visible: boolean;
  featureLabel: string;
  onClose: () => void;
  onSeePlans: () => void;
  onContinueTrial?: () => void;
  trialAvailable: boolean;
};

/**
 * Dismissible upgrade sheet. Never blocks navigation underneath permanently —
 * closing returns the user to whatever they were doing (Coach/browse intact).
 */
export function SoftPaywallModal({
  visible,
  featureLabel,
  onClose,
  onSeePlans,
  onContinueTrial,
  trialAvailable,
}: SoftPaywallModalProps) {
  const colors = useColors();
  const title = featureLabel.trim() ? featureLabel : "Stadium Edge Pro";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
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
        <Pressable
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          accessibilityLabel="Dismiss upgrade"
        />
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
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.primary,
              }}
            >
              <Feather name="zap" size={22} color={colors.primary} />
            </View>
            <Text
              style={{
                fontFamily: FONT.display,
                fontSize: 20,
                color: colors.foreground,
                flex: 1,
              }}
            >
              {title}
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
            Preview subscription unlock. Browse, Coach, and OTA updates keep working
            either way — this sheet is optional. Real App Store billing arrives with a
            native rebuild (not an OTA).
          </Text>

          <View style={{ gap: 10, marginTop: 4 }}>
            {trialAvailable && onContinueTrial ? (
              <Pressable
                onPress={onContinueTrial}
                style={({ pressed }) => ({
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  paddingVertical: 14,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: FONT.bold,
                    fontSize: 15,
                    color: colors.primaryForeground,
                  }}
                >
                  Continue with free trial
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={onSeePlans}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingVertical: 14,
                backgroundColor: colors.background,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: FONT.semibold,
                  fontSize: 15,
                  color: colors.foreground,
                }}
              >
                See plans
              </Text>
            </Pressable>

            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 10,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: FONT.medium,
                  fontSize: 14,
                  color: colors.mutedForeground,
                }}
              >
                Not now
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Navigate to the preview Plans screen. */
export function useOpenPlans() {
  const router = useRouter();
  return React.useCallback(() => {
    router.push("/plans" as never);
  }, [router]);
}
