import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReasoningEffort,
  resolveOpenAIConfig,
} from "../src/lib/openaiConfig.ts";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_CHAT_MODEL",
  "OPENAI_REASONING_EFFORT",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "RENDER",
] as const;

function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void,
): void {
  const saved = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  for (const key of ENV_KEYS) {
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const prev = saved[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

test("parseReasoningEffort accepts supported values and rejects unknown", () => {
  assert.equal(parseReasoningEffort("low"), "low");
  assert.equal(parseReasoningEffort(" HIGH "), "high");
  assert.equal(parseReasoningEffort("minimal"), undefined);
});

test("OPENAI_API_KEY takes precedence over Replit integration vars", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-direct",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      AI_INTEGRATIONS_OPENAI_API_KEY: "replit-key",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "https://ai-integrations.replit.com/v1",
    },
    () => {
      const config = resolveOpenAIConfig();
      assert.ok(!("error" in config));
      assert.equal(config.provider, "openai");
      assert.equal(config.apiKey, "sk-direct");
      assert.equal(config.model, "gpt-4.1");
      assert.equal(config.reasoningEffort, undefined);
    },
  );
});

test("Replit integration vars resolve on non-Render hosts", () => {
  withEnv(
    {
      AI_INTEGRATIONS_OPENAI_API_KEY: "replit-key",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "https://ai-integrations.replit.com/v1",
    },
    () => {
      const config = resolveOpenAIConfig();
      assert.ok(!("error" in config));
      assert.equal(config.provider, "replit");
      assert.equal(config.model, "gpt-5.4");
      assert.equal(config.reasoningEffort, "low");
    },
  );
});

test("Replit integration vars on Render fail fast with a helpful error", () => {
  withEnv(
    {
      RENDER: "true",
      AI_INTEGRATIONS_OPENAI_API_KEY: "replit-key",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "https://ai-integrations.replit.com/v1",
    },
    () => {
      const config = resolveOpenAIConfig();
      assert.ok("error" in config);
      assert.match(config.error, /OPENAI_API_KEY/);
    },
  );
});

test("missing credentials return a configuration error", () => {
  withEnv({}, () => {
    const config = resolveOpenAIConfig();
    assert.ok("error" in config);
    assert.match(config.error, /not configured/i);
  });
});

test("OPENAI_CHAT_MODEL and OPENAI_REASONING_EFFORT overrides apply", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-direct",
      OPENAI_CHAT_MODEL: "gpt-4o",
      OPENAI_REASONING_EFFORT: "medium",
    },
    () => {
      const config = resolveOpenAIConfig();
      assert.ok(!("error" in config));
      assert.equal(config.model, "gpt-4o");
      assert.equal(config.reasoningEffort, "medium");
    },
  );
});
