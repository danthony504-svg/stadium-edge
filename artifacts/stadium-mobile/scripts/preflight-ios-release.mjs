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
  const pk = String(prodEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "");
  const proxy = String(prodEnv.EXPO_PUBLIC_CLERK_PROXY_URL || process.env.EXPO_PUBLIC_CLERK_PROXY_URL || "");
  const rcKey = String(
    prodEnv.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || "",
  );
  const version = app.expo?.version;
  const runtimeVersion = app.expo?.runtimeVersion;
  const bundleId = app.expo?.ios?.bundleIdentifier;
  const associated = app.expo?.ios?.associatedDomains ?? [];
  const notifPlugin = (app.expo?.plugins ?? []).find(
    (p) => Array.isArray(p) && p[0] === "expo-notifications",
  );
  const notifMode = notifPlugin?.[1]?.mode;

  console.log(`version=${version} runtimeVersion=${runtimeVersion} bundleId=${bundleId}`);
  console.log(`eas Clerk key prefix=${pk.slice(0, 12) || "(missing)"}…`);

  if (bundleId !== "com.stadiumedge.app") {
    fail(`bundleId must be com.stadiumedge.app (got ${bundleId})`);
  } else {
    ok(`bundleId ${bundleId}`);
  }

  if (notifMode !== "production") {
    fail(`expo-notifications plugin mode must be "production" (got ${notifMode ?? "unset"})`);
  } else {
    ok(`expo-notifications mode=production`);
  }

  if ((prodEnv.EXPO_PUBLIC_OTA_USER_BANNER ?? "false") === "true") {
    warn("EXPO_PUBLIC_OTA_USER_BANNER=true — production users will see the OTA banner");
  } else {
    ok("OTA user banner hidden for production profile");
  }

  if (!pk) {
    fail("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY missing from eas.json production.env");
  } else if (pk.startsWith("pk_test_")) {
    fail(
      "eas.json production profile still uses pk_test — TestFlight/App Store must not ship the development Clerk instance",
    );
  } else if (pk.startsWith("pk_live_")) {
    ok("eas.json production Clerk key is pk_live");
    if (!proxy.includes("/api/__clerk")) {
      fail("pk_live requires EXPO_PUBLIC_CLERK_PROXY_URL=https://<domain>/api/__clerk");
    } else {
      ok(`Clerk proxy URL set (${proxy})`);
    }
  } else {
    fail(`unrecognized Clerk publishable key shape: ${pk.slice(0, 16)}`);
  }

  const keyHost = decodeClerkHost(pk);
  if (keyHost) {
    const expectApplinks = `applinks:${keyHost}`;
    const expectWebcred = `webcredentials:${keyHost}`;
    if (!associated.includes(expectApplinks) || !associated.includes(expectWebcred)) {
      fail(
        `Associated Domains must include ${expectApplinks} and ${expectWebcred} (have: ${associated.join(", ") || "none"})`,
      );
    } else {
      ok(`Associated Domains match Clerk host ${keyHost}`);
    }
  }

  if (!rcKey) {
    fail(
      "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY missing from eas.json production.env (and process env) — bake the RevenueCat iOS public SDK key before building",
    );
  } else if (rcKey.length < 8) {
    fail("EXPO_PUBLIC_REVENUECAT_IOS_API_KEY looks too short");
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

    console.log(
      `Clerk instance: name=${display.application_name ?? "?"} home=${display.home_url ?? "?"} test_mode=${testMode}`,
    );
    console.log(`first_factors=${JSON.stringify(factors)}`);

    if (testMode) {
      fail(
        "production API Clerk proxy still reports test_mode:true — Render CLERK_SECRET_KEY is bound to a development instance; cut over server secret + publishable key together",
      );
    } else {
      ok("Clerk test_mode:false (production instance)");
    }

    const hasPasskeyFactor = factors.some((f) => /passkey|webauthn/i.test(String(f)));
    if (!hasPasskeyFactor) {
      fail(
        "passkeys not present in Clerk first_factors — enable Passkeys on the intended production Clerk instance before building",
      );
    } else {
      ok("passkeys listed in Clerk first_factors");
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
        const hasAppId =
          body.includes("com.stadiumedge.app") ||
          JSON.stringify(json || {}).includes("com.stadiumedge.app");
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
        "Clerk AASA does not include com.stadiumedge.app — register Native Application (bundle ID + Apple Team ID) on the intended Clerk instance",
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
        ok(`@clerk/expo-passkeys present (direct=${direct} nested=${nested})`);
      }
    } else {
      ok(`${name} @ ${deps[name]}`);
    }
  }

  const deploymentTarget = app.expo?.plugins?.find?.(
    (p) => Array.isArray(p) && p[0] === "expo-build-properties",
  )?.[1]?.ios?.deploymentTarget;
  if (String(deploymentTarget) !== "16.0") {
    fail(`ios.deploymentTarget must be 16.0 for passkeys (got ${deploymentTarget})`);
  } else {
    ok("ios.deploymentTarget=16.0");
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
