import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";

import {
  authorizeCronRequest,
  buildCronAuthDiag,
  expectedCronSecret,
  providedCronSecret,
} from "../src/lib/cronAuth.ts";

function fakeReq(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    get(name: string) {
      return lower[name.toLowerCase()];
    },
  } as unknown as Request;
}

test("expectedCronSecret trims whitespace", () => {
  assert.equal(expectedCronSecret({ NOTIFY_CRON_KEY: "  abc123  " }), "abc123");
  assert.equal(expectedCronSecret({}), "");
});

test("providedCronSecret recognizes x-cron-key and Bearer/Cron schemes", () => {
  assert.deepEqual(
    providedCronSecret(fakeReq({ "x-cron-key": " secret " })),
    { value: "secret", schemeRecognized: true, headerPresent: true },
  );
  assert.deepEqual(
    providedCronSecret(fakeReq({ authorization: "Bearer tok" })),
    { value: "tok", schemeRecognized: true, headerPresent: true },
  );
  assert.deepEqual(
    providedCronSecret(fakeReq({ authorization: "Cron tok2" })),
    { value: "tok2", schemeRecognized: true, headerPresent: true },
  );
  assert.equal(providedCronSecret(fakeReq({})).headerPresent, false);
  assert.equal(
    providedCronSecret(fakeReq({ authorization: "Basic xxx" })).schemeRecognized,
    false,
  );
});

test("buildCronAuthDiag reports mismatch without secret values", () => {
  const diag = buildCronAuthDiag(fakeReq({ "x-cron-key": "wrong" }), {
    NOTIFY_CRON_KEY: "right-secret-value",
  });
  assert.equal(diag.authHeaderPresent, true);
  assert.equal(diag.expectedSecretConfigured, true);
  assert.equal(diag.authSchemeRecognized, true);
  assert.equal(diag.fingerprintMatch, false);
  assert.equal(diag.lengthMatch, false);
  assert.match(diag.rejectionLayer, /cronAuth\.ts:authorizeCronRequest/);
  assert.equal(JSON.stringify(diag).includes("right-secret"), false);
  assert.equal(JSON.stringify(diag).includes("wrong"), false);
});

test("authorizeCronRequest allows matching trimmed secrets", () => {
  let status = 0;
  let body: unknown = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  const ok = authorizeCronRequest(
    fakeReq({ "x-cron-key": "  same-key  " }),
    res,
    { NOTIFY_CRON_KEY: "same-key" },
  );
  assert.equal(ok, true);
  assert.equal(status, 0);
  assert.equal(body, null);

  const denied = authorizeCronRequest(
    fakeReq({ "x-cron-key": "other" }),
    res,
    { NOTIFY_CRON_KEY: "same-key" },
  );
  assert.equal(denied, false);
  assert.equal(status, 403);
  assert.equal((body as { error: string }).error, "forbidden");
  assert.equal((body as { fingerprintMatch: boolean }).fingerprintMatch, false);
});

test("authorizeCronRequest 503 when secret unset", () => {
  let status = 0;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  assert.equal(
    authorizeCronRequest(fakeReq({ "x-cron-key": "x" }), res, {}),
    false,
  );
  assert.equal(status, 503);
});
