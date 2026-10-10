/**
 * Minimal Expo Router root for the dedicated 1.0.3 force-update OTA.
 *
 * Constraints (native runtime 1.0.3):
 * - No Clerk, SubscriptionProvider, purchases, notifications, or OTA runtime.
 * - Prefer React Native primitives only (no expo-image / expo-linking).
 * - Show Update Required immediately — no network required to paint the gate.
 */
import React, { useCallback } from "react";
import {
  Image,
  Linking,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

const LOGO = require("../assets/images/logo.png");
const APP_STORE_URL = "https://apps.apple.com/app/id6776024127";
const MESSAGE =
  "Stadium Edge requires version 1.1.0 or later. Please update from the App Store to continue.";

function ForceUpdateBody() {
  const insets = useSafeAreaInsets();
  const openStore = useCallback(() => {
    void Linking.openURL(APP_STORE_URL);
  }, []);

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
      accessibilityViewIsModal
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.center}>
        <Image source={LOGO} style={styles.logo} accessibilityLabel="Stadium Edge" />
        <Text style={styles.brand}>Stadium Edge</Text>
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.body}>{MESSAGE}</Text>
        <Text style={styles.meta}>Requires 1.1.0 · App Store</Text>
      </View>
      <Pressable
        onPress={openStore}
        accessibilityRole="button"
        accessibilityLabel="Update on the App Store"
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>Update on the App Store</Text>
      </Pressable>
    </View>
  );
}

export default function ForceUpdateRootLayout() {
  return (
    <SafeAreaProvider>
      <ForceUpdateBody />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f172a",
    paddingHorizontal: 28,
    justifyContent: "center",
    gap: 20,
  },
  center: {
    alignItems: "center",
    gap: 16,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 22,
  },
  brand: {
    fontSize: 28,
    fontWeight: "800",
    color: "#f8fafc",
    textAlign: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#38bdf8",
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: "#cbd5e1",
    textAlign: "center",
  },
  meta: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
  },
  button: {
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#38bdf8",
    borderRadius: 14,
    paddingVertical: 16,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
});
