import { useSignIn } from "@clerk/expo";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { type Href, Link, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import {
  AppleAuthButton,
  AUTH_ACCENT,
  AuthDivider,
  AuthField,
  AuthShell,
  GoogleAuthButton,
  PrimaryButton,
} from "@/components/auth";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  clearBiometricLogin,
  getBiometricCapability,
  getSavedLoginEmail,
  loadSavedLogin,
  runBiometricGate,
  saveBiometricLogin,
} from "@/lib/biometricLogin";

type Mode = "signin" | "resetRequest" | "resetVerify";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

// Clerk error codes that mean the stored email/password is genuinely wrong
// (e.g. the password was changed elsewhere). Only these justify forgetting the
// saved biometric login — transient/network/rate-limit errors must not.
const CREDENTIAL_ERROR_CODES = new Set([
  "form_password_incorrect",
  "form_identifier_not_found",
  "form_param_format_invalid",
  "strategy_for_user_invalid",
]);

function isCredentialError(error: unknown): boolean {
  const errs = (error as { errors?: { code?: string }[] } | null)?.errors;
  if (!Array.isArray(errs)) return false;
  return errs.some((e) => !!e.code && CREDENTIAL_ERROR_CODES.has(e.code));
}

const FEATURES: { icon: FeatherName; title: string; desc: string }[] = [
  {
    icon: "refresh-cw",
    title: "Sync Across Devices",
    desc: "Access your picks anytime, anywhere",
  },
  {
    icon: "shield",
    title: "Secure & Private",
    desc: "Your data is always protected",
  },
  {
    icon: "bar-chart-2",
    title: "Built for Bettors",
    desc: "Smarter insights. Better results.",
  },
];

function FeatureRow() {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        marginTop: 26,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingVertical: 18,
        paddingHorizontal: 6,
      }}
    >
      {FEATURES.map((f, i) => (
        <View
          key={f.title}
          style={{
            flex: 1,
            alignItems: "center",
            paddingHorizontal: 8,
            borderLeftWidth: i === 0 ? 0 : 1,
            borderLeftColor: colors.border,
          }}
        >
          <Feather name={f.icon} size={20} color={AUTH_ACCENT} />
          <Text
            style={{
              fontFamily: FONT.bold,
              fontSize: 12,
              color: colors.foreground,
              textAlign: "center",
              marginTop: 8,
            }}
          >
            {f.title}
          </Text>
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 11,
              color: colors.mutedForeground,
              textAlign: "center",
              marginTop: 4,
              lineHeight: 15,
            }}
          >
            {f.desc}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function SignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();

  const [mode, setMode] = React.useState<Mode>("signin");
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [formError, setFormError] = React.useState("");
  const [bioSupported, setBioSupported] = React.useState(false);
  const [bioLabel, setBioLabel] = React.useState("Face ID");
  const [savedEmail, setSavedEmail] = React.useState<string | null>(null);
  const [bioBusy, setBioBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cap, saved] = await Promise.all([
        getBiometricCapability(),
        getSavedLoginEmail(),
      ]);
      if (cancelled) return;
      setBioSupported(cap.supported);
      setBioLabel(cap.label);
      setSavedEmail(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goHome = ({
    session,
    decorateUrl,
  }: {
    session?: { currentTask?: unknown } | null;
    decorateUrl: (url: string) => string;
  }) => {
    if (session?.currentTask) return;
    router.replace(decorateUrl("/") as Href);
  };

  // After a successful password sign-in, offer to remember the credentials
  // behind Face ID / Touch ID so next time is one tap. Resolves once the user
  // has answered so the caller can then finalize + navigate.
  const offerBiometricEnroll = (email: string, pw: string) =>
    new Promise<void>((resolve) => {
      // Skip if biometrics aren't available, or this exact account is already
      // saved. A different account still gets offered (so it can overwrite).
      if (!bioSupported || savedEmail === email) {
        resolve();
        return;
      }
      Alert.alert(
        `Enable ${bioLabel} sign-in?`,
        `Next time, sign in instantly with ${bioLabel} instead of typing your password.`,
        [
          { text: "Not now", style: "cancel", onPress: () => resolve() },
          {
            text: "Enable",
            onPress: async () => {
              const ok = await saveBiometricLogin(email, pw);
              if (ok) setSavedEmail(email);
              resolve();
            },
          },
        ],
        { cancelable: false },
      );
    });

  const handleSubmit = async () => {
    const { error } = await signIn.password({ emailAddress, password });
    if (error) return;

    if (signIn.status === "complete") {
      await offerBiometricEnroll(emailAddress, password);
      await signIn.finalize({ navigate: goHome });
    } else if (signIn.status === "needs_second_factor") {
      const emailCodeFactor = signIn.supportedSecondFactors?.find(
        (f) => f.strategy === "email_code",
      );
      if (emailCodeFactor) await signIn.mfa.sendEmailCode();
    }
  };

  const handleVerify = async () => {
    await signIn.mfa.verifyEmailCode({ code });
    if (signIn.status === "complete") {
      await offerBiometricEnroll(emailAddress, password);
      await signIn.finalize({ navigate: goHome });
    }
  };

  // One-tap sign-in: verify Face ID / Touch ID, pull the stored credentials,
  // and run the normal Clerk password sign-in with them.
  const handleBiometricSignIn = async () => {
    if (bioBusy) return;
    setFormError("");
    setBioBusy(true);
    try {
      // Face ID / Touch ID prompt. A cancelled or failed prompt is a no-op —
      // don't show an error or forget the saved login.
      const passed = await runBiometricGate(`Sign in with ${bioLabel}`);
      if (!passed) return;

      const creds = await loadSavedLogin();
      if (!creds) {
        // Biometric passed but the keychain secret is gone/corrupt. Clear the
        // stale email mirror so the broken button disappears.
        await clearBiometricLogin();
        setSavedEmail(null);
        setFormError(
          `${bioLabel} sign-in isn't set up anymore. Please sign in with your password.`,
        );
        return;
      }

      const { error } = await signIn.password({
        emailAddress: creds.email,
        password: creds.password,
      });
      if (error) {
        setEmailAddress(creds.email);
        if (isCredentialError(error)) {
          // Stored password is genuinely wrong (e.g. changed elsewhere). Forget
          // it so we stop offering a broken shortcut.
          await clearBiometricLogin();
          setSavedEmail(null);
          setFormError(
            `${bioLabel} sign-in didn't work — your password may have changed. Please sign in with your password.`,
          );
        } else {
          // Transient/network error: keep the saved login, just ask to retry.
          setFormError("Something went wrong signing in. Please try again.");
        }
        return;
      }
      if (signIn.status === "complete") {
        await signIn.finalize({ navigate: goHome });
      } else if (signIn.status === "needs_second_factor") {
        const emailCodeFactor = signIn.supportedSecondFactors?.find(
          (f) => f.strategy === "email_code",
        );
        if (emailCodeFactor) await signIn.mfa.sendEmailCode();
      }
    } finally {
      setBioBusy(false);
    }
  };

  // Forgot-password step 1: identify the account, then email a reset code.
  // signIn.create() starts a fresh attempt, clearing any prior sign-in state.
  const handleSendResetCode = async () => {
    setFormError("");
    const created = await signIn.create({ identifier: emailAddress });
    if (created.error) return;
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) return;
    setCode("");
    setNewPassword("");
    setMode("resetVerify");
  };

  // Forgot-password step 2: verify the code and set the new password.
  const handleResetPassword = async () => {
    setFormError("");
    const verified = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (verified.error) return;
    const submitted = await signIn.resetPasswordEmailCode.submitPassword({
      password: newPassword,
    });
    if (submitted.error) return;
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: goHome });
    } else {
      setFormError("Couldn't finish resetting your password. Please try again.");
    }
  };

  // Abandon the reset flow: discard Clerk's in-progress attempt so the normal
  // password / MFA sign-in paths start from a clean state.
  const backToSignIn = async () => {
    await signIn.reset();
    setCode("");
    setNewPassword("");
    setFormError("");
    setMode("signin");
  };

  const TextLink = ({
    label,
    onPress,
    align = "center",
  }: {
    label: string;
    onPress: () => void;
    align?: "center" | "right";
  }) => (
    <Pressable
      onPress={onPress}
      style={{ alignSelf: align === "right" ? "flex-end" : "center" }}
      hitSlop={8}
    >
      <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: AUTH_ACCENT }}>
        {label}
      </Text>
    </Pressable>
  );

  if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
    return (
      <AuthShell title="Verify it's you" subtitle="Enter the code we emailed you">
        <AuthField
          label="Verification code"
          leftIcon="hash"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          error={errors.fields.code?.message}
        />
        <PrimaryButton
          label="Verify"
          onPress={handleVerify}
          loading={fetchStatus === "fetching"}
        />
      </AuthShell>
    );
  }

  if (mode === "resetRequest") {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="Enter your email and we'll send you a reset code"
      >
        <AuthField
          label="Email"
          leftIcon="mail"
          value={emailAddress}
          onChangeText={setEmailAddress}
          placeholder="you@email.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          error={errors.fields.identifier?.message}
        />
        <PrimaryButton
          label="Send reset code"
          onPress={handleSendResetCode}
          disabled={!emailAddress}
          loading={fetchStatus === "fetching"}
        />
        <View style={{ marginTop: 22 }}>
          <TextLink label="Back to sign in" onPress={backToSignIn} />
        </View>
      </AuthShell>
    );
  }

  if (mode === "resetVerify") {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`Enter the code we sent to ${emailAddress} and choose a new password`}
      >
        <AuthField
          label="Reset code"
          leftIcon="hash"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          error={errors.fields.code?.message}
        />
        <AuthField
          label="New password"
          leftIcon="lock"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Your new password"
          secureTextEntry
          error={errors.fields.password?.message}
        />
        <PrimaryButton
          label="Reset password"
          onPress={handleResetPassword}
          disabled={!code || !newPassword}
          loading={fetchStatus === "fetching"}
        />
        {formError ? (
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 13,
              color: colors.destructive,
              textAlign: "center",
              marginTop: 12,
            }}
          >
            {formError}
          </Text>
        ) : null}
        <View style={{ marginTop: 16, gap: 14, alignItems: "center" }}>
          <TextLink label="Resend code" onPress={handleSendResetCode} />
          <TextLink label="Back to sign in" onPress={backToSignIn} />
        </View>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to sync your slips, track your picks, and stay ahead across all your devices."
    >
      {savedEmail && bioSupported ? (
        <>
          <Pressable
            onPress={handleBiometricSignIn}
            disabled={bioBusy}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: AUTH_ACCENT,
              borderRadius: 12,
              paddingVertical: 15,
              opacity: pressed || bioBusy ? 0.85 : 1,
            })}
          >
            {bioBusy ? (
              <ActivityIndicator color={AUTH_ACCENT} />
            ) : (
              <MaterialCommunityIcons
                name={bioLabel === "Face ID" ? "face-recognition" : "fingerprint"}
                size={24}
                color={AUTH_ACCENT}
              />
            )}
            <View>
              <Text
                style={{ fontFamily: FONT.bold, fontSize: 15, color: colors.foreground }}
              >
                Sign in with {bioLabel}
              </Text>
              <Text
                style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}
                numberOfLines={1}
              >
                {savedEmail}
              </Text>
            </View>
          </Pressable>
          <AuthDivider />
        </>
      ) : null}

      {formError ? (
        <Text
          style={{
            fontFamily: FONT.body,
            fontSize: 13,
            color: colors.destructive,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          {formError}
        </Text>
      ) : null}

      <AuthField
        label="Email"
        leftIcon="mail"
        value={emailAddress}
        onChangeText={setEmailAddress}
        placeholder="you@email.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        error={errors.fields.identifier?.message}
      />
      <AuthField
        label="Password"
        leftIcon="lock"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry
        error={errors.fields.password?.message}
      />
      <View style={{ marginTop: -4, marginBottom: 8 }}>
        <TextLink
          label="Forgot password?"
          align="right"
          onPress={() => setMode("resetRequest")}
        />
      </View>
      <PrimaryButton
        label="Sign in"
        onPress={handleSubmit}
        disabled={!emailAddress || !password}
        loading={fetchStatus === "fetching"}
      />

      <AuthDivider />
      <GoogleAuthButton />
      <View style={{ height: 12 }} />
      <AppleAuthButton />

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          marginTop: 22,
        }}
      >
        <Text style={{ fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground }}>
          New here?{" "}
        </Text>
        <Link href="/sign-up" replace>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: AUTH_ACCENT }}>
            Create an account
          </Text>
        </Link>
      </View>

      <FeatureRow />
    </AuthShell>
  );
}
