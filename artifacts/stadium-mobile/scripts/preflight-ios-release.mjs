#!/usr/bin/env node
/**
 * Pre-build gate for Stadium Edge iOS TestFlight / App Store candidates.
 * Fails closed when production auth/passkey/APNs/RevenueCat config is not ready.
 *
 * Usage:
 *   node scripts/preflight-ios-release.mjs
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node scripts/preflight-ios-release.mjs
 *
 * Physical-device tests are intentionally NOT required here (post-build).
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isIosRevenueCatKey, hasNativeWebCredentials } from "./ios-release-validation.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOMAIN = (process.env.EXPO_PUBLIC_DOMAIN || "stadium-edge.onrender.com").trim();
const API = `https://${DOMAIN}`;
const CLERK_ENV_URL = `${API}/api/__clerk/v1/environment`;

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
  console.error(`FAIL  ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
  console.warn(`WARN  ${msg}`);
}
function ok(msg) {
  console.log(`OK    ${msg}`);
}

function decodeClerkHost(publishableKey) {
  const m = String(publishableKey || "").match(/^pk_(?:test|live)_(.+)$/);
  if (!m?.[1]) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8").replace(/\$$/, "").trim();
    return decoded.includes(".") ? decoded : null;
  } catch {
    return null;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function fetchJson(url, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log(`Stadium Edge iOS preflight — API=${API}\n`);

  // --- eas.json / app.json local config ---
  const eas = readJson(join(ROOT, "eas.json"));
  const app = readJson(join(ROOT, "app.json"));
  const prodEnv = eas.build?.production?.env ?? {};
  // Prefer process.env (GitHub/EAS secrets) over committed eas.json so cutover
  // secrets can gate the build without leaving pk_test baked as the winner.
  const pk = String(
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || prodEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "",
  );
  const proxy = String(
    process.env.EXPO_PUBLIC_CLERK_PROXY_URL || prodEnv.EXPO_PUBLIC_CLERK_PROXY_URL || "",
  );
  const rcKey = String(
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ||
      prodEnv.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ||
      "",
  );
  const easPk = String(prodEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "");
  const version = app.expo?.version;
  const runtimeVersion = app.expo?.runtimeVersion;
  const bundleId = app.expo?.ios?.bundleIdentifier;
  const associated = app.expo?.ios?.associatedDomains ?? [];
  const notifPlugin = (app.expo?.plugins ?? []).find(
    (p) => Array.isArray(p) && p[0] === "expo-notifications",
  );
  const notifMode = notifPlugin?.[1]?.mode;

  const buildNumber = String(
    eas.build?.production?.ios?.buildNumber || app.expo?.ios?.buildNumber || "",
  );
  console.log(`version=${version} runtimeVersion=${runtimeVersion} bundleId=${bundleId}`);
  console.log(`ios.buildNumber=${buildNumber || "(unset)"}`);
  console.log(`effective Clerk key=${pk ? "PRESENT" : "MISSING"}`);
  console.log(`eas.json Clerk key=${easPk ? "PRESENT" : "MISSING"}`);

  if (bundleId !== "com.stadiumedge.app") {
    fail(`bundleId must be com.stadiumedge.app (got ${bundleId})`);
  } else {
    ok(`bundleId ${bundleId}`);
  }

  // Highest proven shipping native binary is TestFlight/App Store Build 78 (1.1.0).
  const MIN_NEXT_BUILD = 79;
  const bn = Number.parseInt(buildNumber, 10);
  if (!Number.isFinite(bn) || bn < MIN_NEXT_BUILD) {
    fail(
      `ios.buildNumber must be >= ${MIN_NEXT_BUILD} (above proven Build 78); got ${buildNumber || "unset"}`,
    );
  } else {
    ok(`ios.buildNumber=${bn} (>= ${MIN_NEXT_BUILD}, above Build 78)`);
  }

  if (notifMode !== "production") {
    fail(`expo-notifications plugin mode must be "production" (got ${notifMode ?? "unset"})`);
  } else {
    ok(`expo-notifications mode=production (aps-environment production via plugin)`);
  }

  const otaBanner =
    process.env.EXPO_PUBLIC_OTA_USER_BANNER ?? prodEnv.EXPO_PUBLIC_OTA_USER_BANNER ?? "false";
  if (otaBanner === "true") {
    warn("EXPO_PUBLIC_OTA_USER_BANNER=true — production users will see the OTA banner");
  } else {
    ok("OTA user banner hidden for production profile");
  }

  if (!pk) {
    fail(
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY missing — set GitHub/EAS secret or eas.json production.env",
    );
  } else if (pk.startsWith("pk_test_")) {
    fail(
      "production build env still uses pk_test — TestFlight/App Store must not ship the development Clerk instance",
    );
  } else if (pk.startsWith("pk_live_")) {
    ok("effective Clerk key is pk_live");
    if (!proxy.includes("/api/__clerk")) {
      fail("pk_live requires EXPO_PUBLIC_CLERK_PROXY_URL=https://<domain>/api/__clerk");
    } else {
      ok(`Clerk proxy URL set (${proxy})`);
    }
  } else {
    fail("unrecognized Clerk publishable key shape");
  }

  if (easPk && pk && easPk !== pk) {
    warn(
      "eas.json production Clerk key differs from effective key — workflow must rewrite eas.json / EAS env before queueing the build",
    );
  }

  const keyHost = decodeClerkHost(pk);
  if (pk && !keyHost) fail("Clerk publishable key does not encode a valid frontend host");
  // app.config.js overrides associatedDomains from the publishable key at build time.
  // Static app.json is only a fallback — require either match or document the override.
  if (keyHost) {
    const expectApplinks = `applinks:${keyHost}`;
    const expectWebcred = `webcredentials:${keyHost}`;
    const appConfigPath = join(ROOT, "app.config.js");
    const hasDynamicConfig = existsSync(appConfigPath);
    if (associated.includes(expectApplinks) && associated.includes(expectWebcred)) {
      ok(`Associated Domains match Clerk host ${keyHost}`);
    } else if (hasDynamicConfig) {
      try {
        const require = createRequire(import.meta.url);
        const configure = require(appConfigPath);
        const previous = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
        let resolved;
        try {
          process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = pk;
          resolved = configure().expo?.ios?.associatedDomains ?? [];
        } finally {
          if (previous === undefined) delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
          else process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = previous;
        }
        if (!resolved.includes(expectApplinks) || !resolved.includes(expectWebcred)) {
          fail("Resolved app.config.js Associated Domains do not match Clerk host");
        } else ok("Resolved Associated Domains match Clerk host");
      } catch {
        fail("Could not resolve app.config.js Associated Domains");
      }
    } else {
      fail(
        `Associated Domains must include ${expectApplinks} and ${expectWebcred} (have: ${associated.join(", ") || "none"})`,
      );
    }
  }

  if (!rcKey) {
    fail(
      "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY missing — bake the RevenueCat iOS public SDK key (appl_…) via GitHub/EAS secret or eas.json before building",
    );
  } else if (!isIosRevenueCatKey(rcKey)) {
    fail("RevenueCat iOS SDK key must use appl_ format; Android, test-store and secret keys cannot pass this gate");
  } else {
    ok("RevenueCat iOS API key present in build env");
  }

  // --- Live Clerk via production API proxy ---
  let envJson = null;
  try {
    const { status, json } = await fetchJson(CLERK_ENV_URL);
    if (status !== 200 || !json) {
      fail(`Clerk proxy environment HTTP ${status} at ${CLERK_ENV_URL}`);
    } else {
      envJson = json;
      ok(`Clerk proxy reachable (${CLERK_ENV_URL})`);
    }
  } catch (e) {
    fail(`Clerk proxy unreachable: ${e?.message || e}`);
  }

  if (envJson) {
    const ac = envJson.auth_config || {};
    const us = envJson.user_settings || {};
    const display = envJson.display_config || {};
    const testMode = ac.test_mode === true;
    const factors = Array.isArray(ac.first_factors) ? ac.first_factors : [];
    const passkeySettings = us.passkey_settings || null;
    const passkeyAttr = us.attributes?.passkey || null;
    const instanceType = display.instance_environment_type || null;

    console.log(
      `Clerk instance: name=${display.application_name ?? "?"} type=${instanceType ?? "?"} home=${display.home_url ?? "?"} test_mode=${testMode}`,
    );
    console.log(`first_factors=${JSON.stringify(factors)}`);
    console.log(
      `passkey.attribute.enabled=${passkeyAttr?.enabled ?? "?"} used_for_first_factor=${passkeyAttr?.used_for_first_factor ?? "?"}`,
    );

    if (ac.test_mode !== false || instanceType !== "production") {
      fail(
        "production API Clerk proxy still bound to a development Clerk instance (test_mode/development) — cut over Render CLERK_SECRET_KEY + client pk_live together; do not mix pk_live with a test proxy",
      );
    } else {
      ok("Clerk production instance (test_mode:false)");
    }

    const hasPasskeyFactor = factors.some((f) => /passkey|webauthn/i.test(String(f)));
    const passkeyEnabled = passkeyAttr?.enabled === true;
    if (!passkeyEnabled && !hasPasskeyFactor) {
      fail(
        "passkeys disabled on Clerk instance (attributes.passkey.enabled=false and not in first_factors) — enable Passkeys on the intended production instance before building",
      );
    } else if (!hasPasskeyFactor) {
      fail(
        "passkeys not present in Clerk first_factors — enable Passkeys as a sign-in factor on the intended production Clerk instance before building",
      );
    } else {
      ok("passkeys enabled and listed in Clerk first_factors");
    }

    if (!passkeySettings) {
      warn("passkey_settings missing from Clerk environment payload");
    } else {
      ok(`passkey_settings present (show_sign_in_button=${passkeySettings.show_sign_in_button})`);
    }

    // AASA on the Clerk Frontend API host from the publishable key (or home_url host).
    const aasaHost =
      keyHost ||
      (() => {
        try {
          return new URL(display.home_url).hostname.replace(/^[^.]+\./, (m) =>
            m.includes("accounts") ? "" : m,
          );
        } catch {
          return null;
        }
      })();

    // Prefer the host encoded in the publishable key.
    const hostsToProbe = [...new Set([keyHost, aasaHost].filter(Boolean))];
    let aasaOk = false;
    for (const host of hostsToProbe) {
      const aasaUrl = `https://${host}/.well-known/apple-app-site-association`;
      try {
        const { status, text, json } = await fetchJson(aasaUrl);
        const body = text || "";
        const hasAppId = hasNativeWebCredentials(json, bundleId);
        const emptyObj = body.trim() === "{}" || (json && Object.keys(json).length === 0);
        console.log(`AASA ${aasaUrl} → HTTP ${status} empty=${emptyObj} hasBundle=${hasAppId}`);
        if (status === 200 && hasAppId && !emptyObj) {
          aasaOk = true;
          ok(`AASA on ${host} includes com.stadiumedge.app`);
          break;
        }
      } catch (e) {
        warn(`AASA probe failed for ${host}: ${e?.message || e}`);
      }
    }
    if (!aasaOk) {
      fail(
        "Clerk AASA lacks a valid TeamID.com.stadiumedge.app entry in webcredentials.apps — register Native Application (bundle ID + Apple Team ID) on the intended Clerk instance",
      );
    }
  }

  // --- Native packages expected in binary ---
  const pkg = readJson(join(ROOT, "package.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of [
    "@clerk/expo-passkeys",
    "expo-notifications",
    "react-native-purchases",
    "expo-secure-store",
    "expo-local-authentication",
  ]) {
    if (!deps[name] && name !== "@clerk/expo-passkeys") {
      // @clerk/expo-passkeys may be nested under @clerk/expo — check node_modules
      fail(`package.json missing dependency ${name}`);
    } else if (name === "@clerk/expo-passkeys") {
      const nested = existsSync(join(ROOT, "node_modules/@clerk/expo-passkeys/package.json"));
      const direct = !!deps[name];
      if (!direct && !nested) {
        // Also accept package.json listing under dependencies of workspace
        const listed = JSON.stringify(pkg).includes("@clerk/expo-passkeys");
        if (!listed) fail("@clerk/expo-passkeys not present in package graph");
        else ok("@clerk/expo-passkeys listed in package graph");
      } else {
        ok(`@clerk/expo-passkeys present (direct=${direct} nested=${nested}) — ships ClerkExpoPasskeys + AuthenticationServices`);
      }
    } else {
      ok(`${name} @ ${deps[name]}`);
    }
  }

  // Confirm passkeys are wired via fail-soft getPasskeys() — never a static
  // `@clerk/expo/passkeys` import (Build 78 lacks ClerkExpoPasskeys and that
  // static import tip-boots with updatePreviouslyFailed).
  try {
    const layout = readFileSync(join(ROOT, "app/_layout.tsx"), "utf8");
    const passkeyAuth = readFileSync(join(ROOT, "lib/passkeyAuth.ts"), "utf8");
    if (!layout.includes("__experimental_passkeys") || !layout.includes("getPasskeys")) {
      fail("app/_layout.tsx must wire getPasskeys() into ClerkProvider.__experimental_passkeys");
    } else if (
      /(?:^|\n)\s*import\s[^;]*from\s*["']@clerk\/expo\/passkeys["']/.test(layout)
    ) {
      fail("app/_layout.tsx must not statically import @clerk/expo/passkeys (use getPasskeys)");
    } else if (!passkeyAuth.includes("getPasskeys") || !passkeyAuth.includes("@clerk/expo/passkeys")) {
      fail("lib/passkeyAuth.ts must dynamically load @clerk/expo/passkeys inside getPasskeys()");
    } else {
      ok("ClerkProvider wires __experimental_passkeys via getPasskeys() fail-soft");
    }
  } catch (e) {
    warn(`could not read passkey wiring: ${e?.message || e}`);
  }

  // StoreKit catalog IDs (configuration only — purchases are post-build).
  try {
    const storekit = readFileSync(join(ROOT, "lib/storekitProducts.ts"), "utf8");
    for (const id of ["com.stadiumedge.app.go.weekly", "com.stadiumedge.app.pro.monthly"]) {
      if (!storekit.includes(id)) fail(`storekitProducts.ts missing ${id}`);
      else ok(`StoreKit product id ${id} present in client catalog`);
    }
    if (!storekit.includes('go: "go"') || !storekit.includes('pro: "pro"')) {
      warn("RevenueCat entitlement id strings go/pro not found in expected shape — verify RC dashboard mapping");
    } else {
      ok("RevenueCat entitlement ids go/pro referenced in client");
    }
  } catch (e) {
    warn(`could not read storekitProducts.ts: ${e?.message || e}`);
  }

  const deploymentTarget = app.expo?.plugins?.find?.(
    (p) => Array.isArray(p) && p[0] === "expo-build-properties",
  )?.[1]?.ios?.deploymentTarget;
  if (String(deploymentTarget) !== "16.0") {
    fail(`ios.deploymentTarget must be 16.0 for passkeys (got ${deploymentTarget})`);
  } else {
    ok("ios.deploymentTarget=16.0 (iOS 16+ for passkeys)");
  }

  // expo-apple-authentication must stay OUT (stale Sign in with Apple entitlement).
  if (deps["expo-apple-authentication"]) {
    fail(
      "expo-apple-authentication must not be a dependency — regenerates com.apple.developer.applesignin and breaks the current App Store profile",
    );
  } else {
    ok("expo-apple-authentication absent (AuthenticationServices via Clerk passkeys only)");
  }

  console.log("");
  if (failures.length) {
    console.error(`PREFLIGHT FAILED — ${failures.length} blocker(s). Do not start EAS build.`);
    process.exit(1);
  }
  console.log("PREFLIGHT PASSED — safe to start TestFlight build (physical-device tests remain post-build).");
  if (warnings.length) {
    console.log(`(${warnings.length} warning(s) above)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
