import { test } from "node:test";
import assert from "node:assert/strict";
import { readSSE } from "../shared/sse";
import { callLLMStream } from "../worker/llm";
import { fixture } from "./d1-fixture";
import { seal } from "../worker/security";
const bytes = (s: string) => new TextEncoder().encode(s);
const stream = (parts: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
test("SSE preserves split UTF-8, CRLF, comments and multiline data", async () => {
  const body = bytes(
    ": keepalive\r\nevent: delta\r\ndata: 係数\r\ndata: の意味\r\n\r\n",
  );
  const result = [];
  for await (const e of readSSE(stream([...body].map((b) => Uint8Array.of(b)))))
    result.push(e);
  assert.deepEqual(result, [{ event: "delta", data: "係数\nの意味" }]);
});
test("oversized and interrupted SSE frames fail rather than becoming completed messages", async () => {
  for (const [s, limit] of [
    ["data: abc", 100],
    ["data: abc\n\n", 3],
  ] as const) {
    await assert.rejects(async () => {
      for await (const _ of readSSE(stream([bytes(s)]), limit)) {
      }
    });
  }
});
test("OpenAI and Anthropic streaming expose answer text while excluding reasoning and require a completed stream", async () => {
  const f = fixture(),
    original = globalThis.fetch,
    encrypted = await seal("stream-key", f.env);
  try {
    for (const format of ["openai", "anthropic"]) {
      globalThis.fetch = async (_url, init) => {
        assert.equal(JSON.parse(init!.body as string).stream, true);
        const values =
          format === "openai"
            ? [
                {
                  choices: [
                    { delta: { reasoning_content: "PRIVATE_REASONING" } },
                  ],
                },
                { choices: [{ delta: { content: "係数" } }] },
                {
                  choices: [
                    { delta: { content: "の意味" }, finish_reason: "stop" },
                  ],
                },
              ]
            : [
                {
                  type: "content_block_delta",
                  delta: {
                    type: "thinking_delta",
                    thinking: "PRIVATE_REASONING",
                  },
                },
                {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "係数" },
                },
                {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "の意味" },
                },
                { type: "message_delta", delta: { stop_reason: "end_turn" } },
              ];
        return new Response(
          values.map((x) => "data: " + JSON.stringify(x) + "\n\n").join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      };
      let text = "";
      for await (const x of callLLMStream(
        f.env,
        {
          format,
          model: "test",
          base_url: "https://stream.example.invalid/v1",
          ...encrypted,
        },
        "system",
        "user",
      ))
        text += x;
      assert.equal(text, "係数の意味");
    }
    globalThis.fetch = async () =>
      new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    await assert.rejects(async () => {
      for await (const _ of callLLMStream(
        f.env,
        {
          format: "openai",
          model: "test",
          base_url: "https://stream.example.invalid/v1",
          ...encrypted,
        },
        "system",
        "user",
      )) {
      }
    });
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
