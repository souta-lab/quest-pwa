import { test } from "node:test";
import { APP_VERSION } from "../shared/release";
import assert from "node:assert/strict";
import { callLLM } from "../worker/llm";
import { seal } from "../worker/security";
import { fixture } from "./d1-fixture";

test("OpenAI and Anthropic calls include the configured session and correct auth", async () => {
  const { env } = fixture();
  env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await seal("mock-key", env);
  const original = globalThis.fetch;
  try {
    for (const format of ["openai", "anthropic"]) {
      globalThis.fetch = async (url, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-opencode-session"), "ses_quest-test");
        assert.equal(
          headers.get(format === "anthropic" ? "x-api-key" : "Authorization"),
          format === "anthropic" ? "mock-key" : "Bearer mock-key",
        );
        assert.equal(
          headers.get(format === "anthropic" ? "Authorization" : "x-api-key"),
          null,
        );
        assert.ok(
          String(url).endsWith(
            format === "anthropic" ? "/messages" : "/chat/completions",
          ),
        );
        return Response.json(
          format === "anthropic"
            ? { content: [{ type: "text", text: "ok" }] }
            : { choices: [{ message: { content: "ok" } }] },
        );
      };
      assert.equal(
        (
          await callLLM(
            env,
            {
              format,
              base_url: "https://api.example.com/v1",
              model: "test",
              ...encrypted,
              opencode_session: "ses_quest-test",
            },
            "test",
            "system",
            "prompt",
          )
        ).text,
        "ok",
      );
    }
    globalThis.fetch = async (_url, init) => {
      assert.match(
        new Headers(init?.headers).get("x-opencode-session")!,
        /^[0-9a-f-]{36}$/,
      );
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    };
    await callLLM(
      env,
      {
        format: "openai",
        base_url: "https://api.example.com/v1",
        model: "test",
        ...encrypted,
      },
      "test",
      "system",
      "prompt",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("DeepSeek gets a reasoning budget and never exposes reasoning-only or truncated responses", async () => {
  const { env } = fixture();
  env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await seal("mock-key", env);
  const provider = {
    format: "openai",
    base_url: "https://opencode.ai/zen/go/v1",
    model: "deepseek-v4.1-flash",
    ...encrypted,
  };
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      assert.equal(JSON.parse(init!.body as string).max_tokens, 8192);
      assert.equal(JSON.parse(init!.body as string).reasoning_effort, "medium");
      assert.equal(
        new Headers(init?.headers).get("User-Agent"),
        `quest-pwa/${APP_VERSION}`,
      );
      return Response.json({
        choices: [
          {
            finish_reason: "length",
            message: { content: "", reasoning_content: "private reasoning" },
          },
        ],
      });
    };
    await assert.rejects(
      callLLM(env, provider, provider.model, "system", "prompt", 700),
      /出力上限/,
    );
    assert.equal(calls, 1, "No automatic paid retry");
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "最終回答",
              reasoning_content: "private reasoning",
            },
          },
        ],
        usage: { prompt_tokens: 300, completion_tokens: 2300 },
      });
    const result = await callLLM(
      env,
      provider,
      provider.model,
      "system",
      "prompt",
      700,
    );
    assert.equal(result.text, "最終回答");
    assert.equal(result.usage.output, 2300);
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          { finish_reason: "length", message: { content: "partial answer" } },
        ],
      });
    await assert.rejects(
      callLLM(env, provider, provider.model, "system", "prompt", 700),
      /未完成/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
