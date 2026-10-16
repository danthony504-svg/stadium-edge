/**
 * Coach voice route auth gate — no live OpenAI / Clerk.
 * Mounts the real router; without clerkMiddleware getAuth fails → 401.
 */

import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { describe, it } from "node:test";

import voiceRouter from "../src/routes/voice.ts";

async function withServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", voiceRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("Coach voice routes", () => {
  it("POST /api/voice/stt requires auth", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/voice/stt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: "AAAA" }),
      });
      assert.equal(res.status, 401);
      const json = (await res.json()) as { error?: string };
      assert.equal(json.error, "auth required");
    });
  });

  it("POST /api/voice/tts requires auth", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });
      assert.equal(res.status, 401);
      const json = (await res.json()) as { error?: string };
      assert.equal(json.error, "auth required");
    });
  });
});
