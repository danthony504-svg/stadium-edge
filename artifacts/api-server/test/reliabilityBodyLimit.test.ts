import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Request, Response } from "express";

import { CRASH_MAX_BODY_BYTES } from "../src/lib/reliabilitySanitize.ts";
import { reliabilityCrashBodyLimitEarly } from "../src/middlewares/reliabilityCrashBodyLimit.ts";

function mockRes() {
  const state: { statusCode?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, state };
}

test("early body limit rejects Content-Length > 8kb with 413 before json parse", () => {
  const { res, state } = mockRes();
  let nextCalled = false;
  const req = {
    method: "POST",
    path: "/api/reliability/crashes",
    url: "/api/reliability/crashes",
    headers: { "content-length": String(CRASH_MAX_BODY_BYTES + 1) },
  } as unknown as Request;

  reliabilityCrashBodyLimitEarly(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(state.statusCode, 413);
  assert.deepEqual(state.body, { error: "payload too large" });
});

test("non-crash routes are not affected by early crash body limiter", () => {
  const { res, state } = mockRes();
  let nextCalled = false;
  const req = {
    method: "POST",
    path: "/api/chat",
    url: "/api/chat",
    headers: { "content-length": String(1_000_000) },
  } as unknown as Request;

  reliabilityCrashBodyLimitEarly(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(state.statusCode, undefined);
});

test("app.ts mounts crash body limit before global 5mb json parser", () => {
  const src = readFileSync(join(process.cwd(), "src/app.ts"), "utf8");
  const early = src.indexOf("reliabilityCrashBodyLimitEarly");
  const fiveMb = src.indexOf('express.json({ limit: "5mb" })');
  assert.ok(early > 0 && fiveMb > early);
  assert.match(src, /skipJsonIfCrashBodyParsed/);
});
