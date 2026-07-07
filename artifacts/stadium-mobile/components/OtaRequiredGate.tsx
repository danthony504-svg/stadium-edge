import * as Updates from "expo-updates";
import { addUpdatesStateChangeListener, latestContext } from "expo-updates";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { isKnownCorruptCrashMessage, readLastBootCrash } from "@/lib/crashRecovery";
import { clearDiscoverCache } from "@/lib/discoverSessionCache";
import { applyOtaOnColdStart, recoverFromCorruptOta } from "@/lib/otaUpdater";

type GatePhase = "recovering" | "downloading" | "ready";

/**
 * Blocks when recovering from a corrupt bundle, downloading Discover UI on embedded,
 * or when a downloaded OTA is waiting to apply.
 */
export function OtaRequiredGate({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<GatePhase>(() =>
    !__DEV__ && Updates.isEnabled && Updates.isEmbeddedLaunch ? "downloading" : "ready",
  );
  const [pending, setPending] = useState(() => !!latestContext?.isUpdatePending);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    void (async () => {
      const lastCrash = await readLastBootCrash();
      if (lastCrash && isKnownCorruptCrashMessage(lastCrash)) {
        setPhase("recovering");
        try {
          await recoverFromCorruptOta();
        } catch {
          // fall through — applyOtaOnColdStart may still fetch
        }
      } else if (Updates.isEmbeddedLaunch) {
        setPhase("downloading");
      }

      const reloaded = await applyOtaOnColdStart().catch(() => false);
      if (reloaded) return;

      setPending(!!latestContext?.isUpdatePending);
      setPhase("ready");
    })();
  }, []);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    const sub = addUpdatesStateChangeListener((event) => {
      setPending(!!event.context.isUpdatePending);
    });
    return () => sub.remove();
  }, []);

  if (phase === "recovering" || phase === "downloading") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0f172a",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 28,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text
          style={{
            color: "#94a3b8",
            fontFamily: FONT.medium,
            fontSize: 15,
            textAlign: "center",
            marginTop: 16,
          }}
        >
          {phase === "downloading"
            ? "Downloading Discover Home…"
            : "Downloading fix…"}
        </Text>
      </View>
    );
  }

  if (__DEV__ || !Updates.isEnabled || !pending) {
    return <>{children}</>;
  }

  const restart = () => {
    void clearDiscoverCache().finally(() => {
      void Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
      {children}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: "rgba(15,23,42,0.96)",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 28,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text
          style={{
            color: "#f8fafc",
            fontFamily: FONT.display,
            fontSize: 22,
            textAlign: "center",
            marginTop: 20,
          }}
        >
          Update ready
        </Text>
        <Text
          style={{
            color: "#94a3b8",
            fontFamily: FONT.medium,
            fontSize: 15,
            lineHeight: 22,
            textAlign: "center",
            marginTop: 10,
          }}
        >
          {Updates.isEmbeddedLaunch
            ? "Tap Restart once to load Discover Home (Table Tennis, Coach, and more)."
            : "Stadium Edge downloaded a fix. Tap Restart once to load it."}
        </Text>
        <Pressable
          onPress={restart}
          style={({ pressed }) => ({
            marginTop: 22,
            backgroundColor: "#2563eb",
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 32,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 16 }}>Restart now</Text>
        </Pressable>
      </View>
    </View>
  );
}
