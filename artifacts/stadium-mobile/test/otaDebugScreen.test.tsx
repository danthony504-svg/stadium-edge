import React from "react";
import TestRenderer from "react-test-renderer";

import OtaDebugScreen from "../app/ota-debug";

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Feather: "Feather" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000", card: "#111", border: "#222", foreground: "#fff",
    mutedForeground: "#aaa", primary: "#0af", primaryForeground: "#000",
  }),
}));
jest.mock("@/lib/otaLaunchLog", () => ({ formatOtaLogLines: () => [] }));
jest.mock("@/lib/otaDebug", () => ({
  readOtaDebugSnapshot: () => ({
    updatesEnabled: true, isEmbeddedLaunch: false, isEmergencyLaunch: false,
    emergencyLaunchReason: "—", updateId: "update", runtimeVersion: "1.0.3",
    channel: "production", updateCreatedAt: "now", checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0, launchDurationMs: 1, isUpdatePending: false,
    isDownloading: false, isStartupProcedureRunning: false, rollbackCommitTime: "—",
    checkError: "—", downloadError: "—", bundleSource: "update", appVersion: "1.0.0",
    buildNumber: "1", commitHash: "commit", deployMessage: "—", updateUrl: "url",
    requestHeaders: "{}", projectId: "project",
  }),
  collectOtaFullDiagnostics: jest.fn(async () => {
    throw new Error("offline");
  }),
  forceOtaCheckFetchAndReload: jest.fn(),
}));
jest.mock("@/lib/coachRequestTrace", () => ({
  formatCoachRequestTrace: () => "No Coach request trace recorded yet.",
  loadCoachRequestTrace: async () => null,
  loadCoachMarketPipelineAudit: async () => null,
}));

test("OTA Diagnostics renders when no prior diagnostic storage exists", async () => {
  let screen!: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => {
    screen = TestRenderer.create(<OtaDebugScreen />);
    await Promise.resolve();
  });
  expect(JSON.stringify(screen.toJSON())).toContain("OTA Diagnostics");
  expect(JSON.stringify(screen.toJSON())).toContain("No completed Coach market audit recorded yet.");
});
