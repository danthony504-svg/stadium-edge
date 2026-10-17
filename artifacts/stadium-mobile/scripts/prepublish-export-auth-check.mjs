#!/usr/bin/env node
/**
 * Fail closed before preview/production OTA publish when the public Clerk
 * publishable key is missing from the export environment or from a baked dist.
 *
 * Never requires or embeds server secret keys (sk_* / CLERK_SECRET_KEY).
 *
 * Usage:
 *   node scripts/prepublish-export-auth-check.mjs
 *   node scripts/prepublish-export-auth-check.mjs --dist dist
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const distIdx = args.indexOf("--dist");
const distDir = distIdx >= 0 ? args[distIdx + 1] : null;

const PUBLISHABLE_RE = /^pk_(test|live)_[A-Za-z0-9+/=_-]{16,}$/;
const SECRET_ENV_NAMES = [
  "CLERK_SECRET_KEY",
  "CLERK_SECRET",
  "EXPO_PUBLIC_CLERK_SECRET_KEY",
  "EXPO_PUBLIC_CLERK_SECRET",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const pk = String(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "").trim();
if (!pk) {
  fail(
    "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing/empty in the export environment. " +
      "eas.json build.env is NOT applied by `expo export` / `eas update --skip-bundler`. " +
      "Export with the publishable key set (never a secret key).",
  );
}
if (!PUBLISHABLE_RE.test(pk)) {
  fail(
    `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must look like pk_test_… or pk_live_… (got length=${pk.length}).`,
  );
}
ok(`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY present (${pk.slice(0, 12)}…)`);

for (const name of SECRET_ENV_NAMES) {
  if (process.env[name]) {
    fail(
      `${name} must not be set for client export/publish. Never bake server secrets into the bundle.`,
    );
  }
}
ok("No Clerk secret-key env vars set for client export");

// Public EXPO_PUBLIC_* must never carry sk_* values.
for (const [k, v] of Object.entries(process.env)) {
  if (!k.startsWith("EXPO_PUBLIC_")) continue;
  if (typeof v === "string" && /\bsk_(?:test|live)_/.test(v)) {
    fail(`${k} contains a Clerk secret key pattern — refuse to publish.`);
  }
}
ok("No EXPO_PUBLIC_* value contains sk_test_/sk_live_");

if (distDir) {
  if (!existsSync(distDir)) {
    fail(`dist dir not found: ${distDir}`);
  }
  const iosJs = join(distDir, "_expo", "static", "js", "ios");
  if (!existsSync(iosJs)) {
    fail(`no iOS JS bundle dir under ${distDir}`);
  }
  const bundles = readdirSync(iosJs).filter((f) => f.endsWith(".hbc") || f.endsWith(".js"));
  if (!bundles.length) {
    fail(`no .hbc/.js launch assets in ${iosJs}`);
  }
  let foundPk = false;
  let foundSecret = false;
  for (const file of bundles) {
    const path = join(iosJs, file);
    if (!statSync(path).isFile()) continue;
    const buf = readFileSync(path);
    // Latin-1 scan is enough for ASCII-baked env strings in Hermes bytecode.
    const text = buf.toString("latin1");
    if (text.includes(pk)) foundPk = true;
    if (/\bsk_(?:test|live)_[A-Za-z0-9+/=_-]{8,}/.test(text)) foundSecret = true;
  }
  if (foundSecret) {
    fail("Launch asset contains sk_test_/sk_live_ — refuse to publish.");
  }
  if (!foundPk) {
    fail(
      `Launch asset under ${iosJs} does not contain EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. ` +
        "Re-export with the key in the Metro environment (do not rely on eas.json alone).",
    );
  }
  ok(`dist launch asset contains publishable key (${bundles.join(", ")})`);
  ok("dist launch asset has no Clerk secret keys");
}

console.log("prepublish-export-auth-check: pass");
