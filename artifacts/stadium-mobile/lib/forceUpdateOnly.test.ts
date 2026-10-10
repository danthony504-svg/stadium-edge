import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FORCE_UPDATE_APP_STORE_URL } from "./forceUpdateOnly.ts";

const forceRoot = join(
  process.cwd().endsWith("stadium-mobile")
    ? process.cwd()
    : join(process.cwd(), "artifacts/stadium-mobile"),
  "app.forceUpdate/_layout.tsx",
);

test("force-update App Store URL matches Stadium Edge listing id", () => {
  assert.equal(FORCE_UPDATE_APP_STORE_URL, "https://apps.apple.com/app/id6776024127");
});

test("force-update root avoids StoreKit, Clerk, and expo-image/linking", () => {
  const src = readFileSync(forceRoot, "utf8");
  const imports = src
    .split("\n")
    .filter((l) => /^\s*import\s/.test(l) || /^\s*const\s.*=\s*require\(/.test(l))
    .join("\n");
  assert.doesNotMatch(imports, /react-native-purchases|RNPurchases|SubscriptionProvider|ClerkProvider/);
  assert.doesNotMatch(imports, /expo-image|expo-linking|DeferredOtaRuntime|notifications/);
  assert.match(imports, /react-native/);
  assert.match(src, /Linking\.openURL/);
  assert.match(src, /id6776024127/);
  assert.match(src, /Update Required/);
});
