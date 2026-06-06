import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";

const STORAGE_KEY = "se_app_lock_enabled";

type AppLockValue = {
  /** Whether the user has turned the biometric lock on. */
  enabled: boolean;
  /** True while the app is gated behind the lock screen. */
  locked: boolean;
  /** Device has biometric hardware AND the user has enrolled a face/finger. */
  supported: boolean;
  /** Human label for the available biometric ("Face ID", "Touch ID", ...). */
  biometricLabel: string;
  /** Persisted setting + hardware check have finished loading. */
  ready: boolean;
  /** Run the biometric prompt; on success clears the lock. Returns success. */
  authenticate: () => Promise<boolean>;
  /** Turn the lock on/off. Enabling first verifies biometrics. Returns success. */
  setEnabled: (next: boolean) => Promise<boolean>;
};

const AppLockContext = createContext<AppLockValue | null>(null);

export function useAppLock(): AppLockValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within an AppLockProvider");
  return ctx;
}

async function detectBiometricLabel(): Promise<string> {
  try {
    const types =
      await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (
      types.includes(
        LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
      )
    ) {
      return "Face ID";
    }
    if (
      types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
    ) {
      return Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
    }
  } catch {
    // fall through to generic label
  }
  return "Biometrics";
}

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [supported, setSupported] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Face ID");
  const [ready, setReady] = useState(false);

  // Tracks whether a biometric prompt is currently on screen. The native
  // prompt pushes the app into the "inactive" state, so we must ignore
  // app-state changes while authenticating to avoid a re-lock loop.
  const authenticatingRef = useRef(false);
  // Latest app state, so we only re-lock on a real background transition.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  // Keep the latest enabled/supported readable inside the AppState listener.
  const enabledRef = useRef(false);
  const supportedRef = useRef(false);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    supportedRef.current = supported;
  }, [supported]);

  // Load persisted setting + check hardware on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hwSupported = false;
      let label = "Face ID";
      try {
        const [hasHardware, isEnrolled, detected] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          detectBiometricLabel(),
        ]);
        hwSupported = hasHardware && isEnrolled;
        label = detected;
      } catch {
        hwSupported = false;
      }

      let savedEnabled = false;
      try {
        savedEnabled = (await AsyncStorage.getItem(STORAGE_KEY)) === "1";
      } catch {
        savedEnabled = false;
      }

      if (cancelled) return;
      const effectiveEnabled = savedEnabled && hwSupported;
      setSupported(hwSupported);
      setBiometricLabel(label);
      setEnabledState(effectiveEnabled);
      // Lock on cold start when the feature is on.
      setLocked(effectiveEnabled);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!supportedRef.current) {
      setLocked(false);
      return true;
    }
    if (authenticatingRef.current) return false;
    authenticatingRef.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Stadium Edge",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });
      if (result.success) {
        setLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      authenticatingRef.current = false;
    }
  }, []);

  const setEnabled = useCallback(
    async (next: boolean): Promise<boolean> => {
      if (next) {
        if (!supportedRef.current) return false;
        // Verify the user can pass the biometric before turning it on.
        const ok = await authenticate();
        if (!ok) return false;
        try {
          await AsyncStorage.setItem(STORAGE_KEY, "1");
        } catch {
          // best-effort persistence
        }
        setEnabledState(true);
        setLocked(false);
        return true;
      }
      try {
        await AsyncStorage.setItem(STORAGE_KEY, "0");
      } catch {
        // best-effort persistence
      }
      setEnabledState(false);
      setLocked(false);
      return true;
    },
    [authenticate],
  );

  // Re-lock when the app is sent to the background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      // Only react to a genuine background transition. The native biometric
      // prompt and the app-switcher peek report "inactive", which we ignore.
      if (
        nextState === "background" &&
        prev !== "background" &&
        enabledRef.current &&
        supportedRef.current &&
        !authenticatingRef.current
      ) {
        setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <AppLockContext.Provider
      value={{
        enabled,
        locked,
        supported,
        biometricLabel,
        ready,
        authenticate,
        setEnabled,
      }}
    >
      {children}
    </AppLockContext.Provider>
  );
}
