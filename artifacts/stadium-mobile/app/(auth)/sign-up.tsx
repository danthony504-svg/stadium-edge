import { getClerkInstance, useSignUp } from "@clerk/expo";
import { passkeys } from "@clerk/expo/passkeys";
import { type Href, Link, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import {
  APPLE_SIGN_IN_ENABLED,
  AppleAuthButton,
  AuthDivider,
  AuthField,
  AuthShell,
  PrimaryButton,
  SecondaryButton,
} from "@/components/auth";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  AUTH_EMAIL_AUTOFILL,
  AUTH_NEW_PASSWORD_AUTOFILL,
  AUTH_OTP_AUTOFILL,
} from "@/lib/authFieldAutofill";
import {
  describePasskeyError,
  describeSignupError,
  generateMachinePassword,
  isDuplicateEmailError,
  isPasskeyCancellation,
} from "@/lib/passkeyAuth";
import {
  resolvePostAuthHref,
  signInHrefPreservingReturn,
} from "@/lib/pendingSubscriptionIntent";
import { loadPendingSubscriptionIntent } from "@/lib/pendingSubscriptionIntentStorage";

export default function SignUpScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{
    returnTo?: string;
    plan?: string;
    intent?: string;
  }>();
  const { signUp, errors, fetchStatus } = useSignUp();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [formError, setFormError] = React.useState("");
  const [passkeyBusy, setPasskeyBusy] = React.useState(false);
  const [verifyBusy, setVerifyBusy] = React.useState(false);
  // When true, after email verify we create a WebAuthn passkey (Face ID / Touch ID)
  // instead of requiring the user to remember a password.
  const pendingPasskeyRef = React.useRef(false);
  const passkeySupported = React.useMemo(() => {
    try {
      return passkeys.isSupported();
    } catch {
      return false;
    }
  }, []);

  const signInHref = React.useMemo(() => {
    const q = new URLSearchParams();
    if (params.returnTo) q.set("returnTo", String(params.returnTo));
    if (params.plan) q.set("plan", String(params.plan));
    if (params.intent) q.set("intent", String(params.intent));
    return signInHrefPreservingReturn(q.toString());
  }, [params.returnTo, params.plan, params.intent]);

  const navigateAfterAuth = React.useCallback(
    ({
      session,
      decorateUrl,
    }: {
      session?: { currentTask?: unknown } | null;
      decorateUrl: (url: string) => string;
    }) => {
      if (session?.currentTask) return;
      void (async () => {
        const stored = await loadPendingSubscriptionIntent();
        const target = resolvePostAuthHref({
          returnTo: typeof params.returnTo === "string" ? params.returnTo : null,
          plan: typeof params.plan === "string" ? params.plan : null,
          intent: typeof params.intent === "string" ? params.intent : null,
          stored,
        });
        router.replace(decorateUrl(target) as Href);
      })();
    },
    [params.intent, params.plan, params.returnTo, router],
  );

  const goHomeViaRouter = React.useCallback(async () => {
    const stored = await loadPendingSubscriptionIntent();
    const target = resolvePostAuthHref({
      returnTo: typeof params.returnTo === "string" ? params.returnTo : null,
      plan: typeof params.plan === "string" ? params.plan : null,
      intent: typeof params.intent === "string" ? params.intent : null,
      stored,
    });
    router.replace(target as Href);
  }, [params.intent, params.plan, params.returnTo, router]);

  const handleSubmit = async () => {
    setFormError("");
    pendingPasskeyRef.current = false;
    const { error } = await signUp.password({ emailAddress, password });
    if (error) {
      setFormError(describeSignupError(error));
      return;
    }
    await signUp.verifications.sendEmailCode();
  };

  /** Passkey Sign Up: email + Face ID/Touch ID. No user-facing password. */
  const handlePasskeySignUp = async () => {
    if (passkeyBusy) return;
    setFormError("");
    if (!emailAddress.trim()) {
      setFormError("Enter your email to create a passkey account.");
      return;
    }
    if (!passkeySupported) {
      setFormError("Passkeys aren't available on this device.");
      return;
    }
    setPasskeyBusy(true);
    try {
      const machinePassword = generateMachinePassword();
      const { error } = await signUp.password({
        emailAddress: emailAddress.trim(),
        password: machinePassword,
      });
      if (error) {
        setFormError(describeSignupError(error));
        // Duplicate email must not create a second account — Clerk already refused.
        if (isDuplicateEmailError(error)) pendingPasskeyRef.current = false;
        return;
      }
      pendingPasskeyRef.current = true;
      await signUp.verifications.sendEmailCode();
    } catch (err) {
      setFormError(describePasskeyError(err, "sign_up"));
      pendingPasskeyRef.current = false;
    } finally {
      setPasskeyBusy(false);
    }
  };

  const createPasskeyForActiveUser = async (): Promise<string | null> => {
    try {
      const clerk = getClerkInstance();
      const user = clerk.user;
      if (!user) {
        return "Account created, but passkey setup needs another moment. You can add one after signing in.";
      }
      await user.createPasskey();
      return null;
    } catch (err) {
      if (isPasskeyCancellation(err)) {
        return describePasskeyError(err, "create");
      }
      return describePasskeyError(err, "create");
    }
  };

  const handleVerify = async () => {
    if (verifyBusy) return;
    setFormError("");
    setVerifyBusy(true);
    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code });
      if (error) {
        setFormError(extractFieldOrMessage(error) || "Incorrect verification code");
        return;
      }
      if (signUp.status !== "complete") return;

      if (pendingPasskeyRef.current) {
        // Activate session first (Clerk requires a signed-in user to create a passkey).
        await signUp.finalize();
        // Face ID cancel or failure must not freeze — account is already created
        // and the session is active. User can add a passkey later from Account.
        await createPasskeyForActiveUser();
        pendingPasskeyRef.current = false;
        await goHomeViaRouter();
        return;
      }

      await signUp.finalize({ navigate: navigateAfterAuth });
    } catch (err) {
      setFormError(describePasskeyError(err, "sign_up"));
    } finally {
      setVerifyBusy(false);
    }
  };

  const needsCode =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

  if (needsCode) {
    return (
      <AuthShell title="Verify your email" subtitle="Enter the code we just sent you">
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
          label="Verification code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          {...AUTH_OTP_AUTOFILL}
          error={errors.fields.code?.message}
        />
        <PrimaryButton
          label="Verify & continue"
          onPress={handleVerify}
          loading={verifyBusy || fetchStatus === "fetching"}
        />
        <View style={{ alignItems: "center", marginTop: 16 }}>
          <Text
            onPress={() => signUp.verifications.sendEmailCode()}
            style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.primary }}
          >
            Resend code
          </Text>
        </View>
        <View nativeID="clerk-captcha" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign Up" subtitle="Create your Stadium Edge account">
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
        value={emailAddress}
        onChangeText={setEmailAddress}
        placeholder="you@email.com"
        keyboardType="email-address"
        {...AUTH_EMAIL_AUTOFILL}
        error={errors.fields.emailAddress?.message}
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Create a password"
        secureTextEntry
        {...AUTH_NEW_PASSWORD_AUTOFILL}
        error={errors.fields.password?.message}
      />
      <PrimaryButton
        label="Sign Up"
        onPress={handleSubmit}
        disabled={!emailAddress || !password}
        loading={fetchStatus === "fetching" && !passkeyBusy}
      />

      {passkeySupported ? (
        <>
          <AuthDivider />
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 13,
              color: colors.mutedForeground,
              textAlign: "center",
              marginBottom: 4,
            }}
          >
            Or create an account with Face ID / Touch ID — no password to remember.
          </Text>
          <SecondaryButton
            label="Sign Up with Passkey"
            leftIcon="smartphone"
            onPress={handlePasskeySignUp}
            disabled={!emailAddress.trim()}
            loading={passkeyBusy}
          />
        </>
      ) : null}

      {APPLE_SIGN_IN_ENABLED ? (
        <>
          <AuthDivider />
          <AppleAuthButton
            returnTo={typeof params.returnTo === "string" ? params.returnTo : null}
            plan={typeof params.plan === "string" ? params.plan : null}
            intent={typeof params.intent === "string" ? params.intent : null}
          />
        </>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          marginTop: 22,
        }}
      >
        <Text style={{ fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground }}>
          Already have an account?{" "}
        </Text>
        <Link href={signInHref as Href} replace>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.primary }}>
            Sign In
          </Text>
        </Link>
      </View>

      {/* Required for sign-up — Clerk's bot protection is enabled by default. */}
      <View nativeID="clerk-captcha" />
    </AuthShell>
  );
}

function extractFieldOrMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as {
    message?: string;
    errors?: Array<{ message?: string; longMessage?: string }>;
  };
  const first = e.errors?.[0];
  return first?.longMessage || first?.message || e.message || null;
}
