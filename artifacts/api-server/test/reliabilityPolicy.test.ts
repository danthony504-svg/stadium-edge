import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allowTelegramWithoutSharedDedupe,
  RELIABILITY_HOURLY_OCCURRENCE_BUDGET,
  reliabilitySecurityModelSummary,
} from "../src/lib/reliabilityPolicy.ts";

test("allowTelegramWithoutSharedDedupe is always false", () => {
  assert.equal(allowTelegramWithoutSharedDedupe(), false);
});

test("hourly budget constant is within safe Render bounds", () => {
  assert.ok(RELIABILITY_HOURLY_OCCURRENCE_BUDGET <= 500);
});

test("security model summary flips with REDIS_URL", () => {
  assert.equal(
    reliabilitySecurityModelSummary({} as NodeJS.ProcessEnv).ipRateLimitScope,
    "per-instance-memory",
  );
  assert.equal(
    reliabilitySecurityModelSummary({
      REDIS_URL: "redis://localhost:6379",
    } as NodeJS.ProcessEnv).ipRateLimitScope,
    "shared-redis",
  );
});
