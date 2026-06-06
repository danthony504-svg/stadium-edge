import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useAppLock } from "@/context/AppLockContext";
import { useColors } from "@/hooks/useColors";

const ICON = require("@/assets/images/icon.png");

/**
 * Full-screen biometric gate. Rendered above the whole app while the lock is
 * engaged. Auto-prompts for Face ID / Touch ID once on mount, and offers a
 * retry button if the user cancels or fails.
 */
export function LockScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authenticate, biometricLabel } = useAppLock();
  const [attempting, setAttempting] = useState(true);
  const promptedRef = useRef(false);

  const run = async () => {
    setAttempting(true);
    await authenticate();
    setAttempting(false);
  };

  // Auto-trigger the prompt once when the lock screen appears.
  useEffect(() => {
    if (promptedRef.current) return;
    promptedRef.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 24,
        zIndex: 9999,
      }}
    >
      <View style={{ flex: 1 }} />

      <Image
        source={ICON}
        style={{ width: 96, height: 96, borderRadius: 22, marginBottom: 24 }}
      />
      <Text
        style={{
          fontFamily: FONT.display,
          fontSize: 24,
          color: colors.foreground,
          marginBottom: 8,
        }}
      >
        Stadium Edge
      </Text>
      <Text
        style={{
          fontFamily: FONT.body,
          fontSize: 15,
          color: colors.mutedForeground,
          textAlign: "center",
        }}
      >
        {attempting
          ? `Unlock with ${biometricLabel} to continue`
          : "Locked — authenticate to continue"}
      </Text>

      <View style={{ flex: 1 }} />

      <Pressable
        onPress={run}
        disabled={attempting}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          alignSelf: "stretch",
          backgroundColor: colors.primary,
          borderRadius: 14,
          paddingVertical: 16,
          opacity: pressed || attempting ? 0.85 : 1,
        })}
      >
        <Feather name="lock" size={18} color={colors.primaryForeground} />
        <Text
          style={{
            fontFamily: FONT.bold,
            fontSize: 16,
            color: colors.primaryForeground,
          }}
        >
          {attempting ? "Authenticating…" : `Unlock with ${biometricLabel}`}
        </Text>
      </Pressable>
    </View>
  );
}
