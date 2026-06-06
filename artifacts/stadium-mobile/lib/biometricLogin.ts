import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Encrypted-keychain entry holding the user's email + password so we can sign
// them back in after a biometric check. The plain email is mirrored to
// AsyncStorage so the sign-in screen can decide whether to SHOW the Face ID
// button (and which account it belongs to) without triggering a prompt.
const SECURE_KEY = "se_biometric_login_v1";
const EMAIL_KEY = "se_biometric_login_email";

export type BiometricCapability = { supported: boolean; label: string };

export async function detectBiometricLabel(): Promise<string> {
  try {
    const types =
      await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (
      types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ) {
      return "Face ID";
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
    }
  } catch {
    // fall through to generic label
  }
  return "Biometrics";
}

// Device has biometric hardware AND the user has enrolled a face/finger.
export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, isEnrolled, label] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      detectBiometricLabel(),
    ]);
    return { supported: hasHardware && isEnrolled, label };
  } catch {
    return { supported: false, label: "Biometrics" };
  }
}

// Email of the saved biometric login, or null if none. Cheap — no prompt.
export async function getSavedLoginEmail(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

// Persist credentials behind the device keychain. WHEN_UNLOCKED_THIS_DEVICE_ONLY
// keeps the secret on this device only and unreadable while the phone is locked.
export async function saveBiometricLogin(
  email: string,
  password: string,
): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(
      SECURE_KEY,
      JSON.stringify({ email, password }),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
    await AsyncStorage.setItem(EMAIL_KEY, email);
    return true;
  } catch {
    return false;
  }
}

// Show the Face ID / Touch ID prompt. Returns true only when the user passes.
// Kept separate from loading so the caller can tell a cancelled prompt (do
// nothing) apart from a missing keychain secret (heal the inconsistency).
export async function runBiometricGate(
  promptMessage: string,
): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}

// Read the stored credentials. Call only after runBiometricGate() succeeds.
// Returns null if nothing valid is stored (caller should clear the mirror).
export async function loadSavedLogin(): Promise<{
  email: string;
  password: string;
} | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string; password?: string };
    if (parsed?.email && parsed?.password) {
      return { email: parsed.email, password: parsed.password };
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearBiometricLogin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_KEY);
  } catch {
    // best-effort
  }
  try {
    await AsyncStorage.removeItem(EMAIL_KEY);
  } catch {
    // best-effort
  }
}
