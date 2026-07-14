import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkLoaded, ClerkLoading, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import * as Updates from "expo-updates";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OtaDiagnosticsBanner } from "@/components/OtaDiagnosticsBanner";
import { OtaRequiredGate } from "@/components/OtaRequiredGate";
import { OtaStartupGate } from "@/components/OtaStartupGate";
import { OtaUpdateBanner } from "@/components/OtaUpdateBanner";
import { BetSlipProvider } from "@/context/BetSlipContext";
import { PickTrackerProvider } from "@/context/PickTrackerContext";
import { setAuthTokenGetter } from "@/lib/api";
import { OTA_BOOTSTRAP } from "@/lib/otaBootstrap";
import { noteOtaBundleActive, safeReloadPendingOta, shouldApplyDownloadedOta } from "@/lib/otaAutoApply";
import { launchOtaCheckFetchReload } from "@/lib/otaLaunch";
import { applyOtaUpdateIfAvailable, useOtaUpdater } from "@/lib/otaUpdater";
import {
  addNotificationResponseListener,
  registerForPushAsync,
} from "@/lib/notifications";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const proxyUrl = publishableKey.startsWith("pk_live")
  ? process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined
  : undefined;

function AuthTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function PushNotificationsBridge() {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isSignedIn) return;
    registerForPushAsync().catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    void addNotificationResponseListener((path) => router.navigate(path as never)).then(
      (listener) => {
        sub = listener;
      },
    );
    return () => sub?.remove();
  }, [router]);

  return null;
}

SplashScreen.preventAutoHideAsync();
SystemUI.setBackgroundColorAsync("#0f172a");

const queryClient = new QueryClient({ defaultOptions: { queries: {} } });
const DARK_BG = "#0f172a";

function BootScreen() {
  const [showRetry, setShowRetry] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowRetry(true), 15000);
    return () => clearTimeout(t);
  }, []);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: DARK_BG,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <ActivityIndicator size="large" color="#38bdf8" />
      {showRetry ? (
        <>
          <Text
            style={{
              color: "#e2e8f0",
              fontSize: 15,
              lineHeight: 21,
              textAlign: "center",
              marginTop: 22,
            }}
          >
            Having trouble connecting. Check your internet connection and try again.
          </Text>
          <Pressable
            onPress={() => {
              if (OTA_BOOTSTRAP) {
                Updates.reloadAsync().catch(() => {});
                return;
              }
              void applyOtaUpdateIfAvailable().finally(() => {
                Updates.reloadAsync().catch(() => {});
              });
            }}
            style={{
              marginTop: 18,
              paddingVertical: 11,
              paddingHorizontal: 28,
              backgroundColor: "#1e293b",
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "#38bdf8", fontSize: 15, fontWeight: "600" }}>
              Retry
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

/** After startup, apply a downloaded OTA once (loop-guarded). */
function PendingOtaAutoApply() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;
    void noteOtaBundleActive();

    const delayMs = OTA_BOOTSTRAP ? 800 : 400;
    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        if (shouldApplyDownloadedOta()) {
          await safeReloadPendingOta("post-startup-pending");
          return;
        }
        await launchOtaCheckFetchReload();
      })();
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return null;
}

function OtaBridge() {
  const otaUpdating = useOtaUpdater(true);
  if (!otaUpdating) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: "rgba(15,23,42,0.92)",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <ActivityIndicator size="large" color="#38bdf8" />
      <Text
        style={{
          color: "#e2e8f0",
          fontSize: 15,
          lineHeight: 21,
          textAlign: "center",
          marginTop: 18,
        }}
      >
        Updating Stadium Edge…
      </Text>
    </View>
  );
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: DARK_BG },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="game/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="prop/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="team-pick/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="upcoming" options={{ presentation: "card" }} />
      <Stack.Screen name="(auth)" options={{ presentation: "card" }} />
      <Stack.Screen name="account" options={{ presentation: "card" }} />
      <Stack.Screen name="notifications" options={{ presentation: "card" }} />
      <Stack.Screen name="ota-debug" options={{ presentation: "card" }} />
    </Stack>
  );
}

function AppShell() {
  if (OTA_BOOTSTRAP) {
    return (
      <OtaStartupGate>
        <PendingOtaAutoApply />
        <QueryClientProvider client={queryClient}>
          <AuthTokenBridge />
          <PushNotificationsBridge />
          <BetSlipProvider>
            <PickTrackerProvider>
              <GestureHandlerRootView style={{ flex: 1, backgroundColor: DARK_BG }}>
                <KeyboardProvider>
                  <StatusBar style="light" />
                  <OtaRequiredGate>
                    <RootLayoutNav />
                  </OtaRequiredGate>
                  <OtaUpdateBanner />
                  <OtaDiagnosticsBanner />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </PickTrackerProvider>
          </BetSlipProvider>
        </QueryClientProvider>
      </OtaStartupGate>
    );
  }

  return (
    <OtaStartupGate>
      <PendingOtaAutoApply />
      <OtaBridge />
      <QueryClientProvider client={queryClient}>
        <AuthTokenBridge />
        <PushNotificationsBridge />
        <BetSlipProvider>
          <PickTrackerProvider>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: DARK_BG }}>
              <KeyboardProvider>
                <StatusBar style="light" />
                <OtaRequiredGate>
                  <RootLayoutNav />
                </OtaRequiredGate>
                <OtaUpdateBanner />
                <OtaDiagnosticsBanner />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </PickTrackerProvider>
        </BetSlipProvider>
      </QueryClientProvider>
    </OtaStartupGate>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    BricolageGrotesque_400Regular: BricolageGrotesque_400Regular,
    BricolageGrotesque_600SemiBold: BricolageGrotesque_600SemiBold,
    BricolageGrotesque_800ExtraBold: BricolageGrotesque_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!publishableKey) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK_BG, padding: 32, justifyContent: "center" }}>
        <Text style={{ color: "#e2e8f0", fontSize: 15, textAlign: "center", lineHeight: 22 }}>
          App configuration error (missing auth key). Reinstall from the App Store or contact support.
        </Text>
      </View>
    );
  }

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <BootScreen />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
          <ClerkLoading>
            <BootScreen />
          </ClerkLoading>
          <ClerkLoaded>
            <AppShell />
          </ClerkLoaded>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
