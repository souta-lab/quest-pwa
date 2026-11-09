import { test } from "node:test";
import assert from "node:assert/strict";
import { questionChat } from "../worker/question-chat";
import { fixture } from "./d1-fixture";
import { bank } from "../worker/bank";
import { seal } from "../worker/security";
const approved = { safe: true, grounded: true, useful: true, relevant: true };
const reply = (value: unknown) =>
  Response.json({
    choices: [
      {
        message: {
          content: typeof value === "string" ? value : JSON.stringify(value),
        },
      },
    ],
  });
const first = "係数とは、文字に掛かっている数を表す名前です。",
  second = "負の数も係数に含めて考えます。";
async function setup() {
  const f = fixture();
  return {
    ...f,
    provider: {
      format: "openai",
      base_url: "https://chat.example.invalid/v1",
      model: "test",
      ...(await seal("chat-test-key", f.env)),
    },
    q: {
      ...bank[0],
      stem: "式 $y=ax+b$ の文字を整理する。",
      explanation: "CHECKER_ONLY_SECRET",
    },
  };
}
test(
  "a question-specific checked sentence is displayed before the writer finishes; later checks include its entire prefix",
  { timeout: 3000 },
  async () => {
    const f = await setup(),
      original = globalThis.fetch;
    let upstream!: ReadableStreamDefaultController<Uint8Array>,
      checks = 0,
      seen = false;
    let shown!: () => void;
    const firstShown = new Promise<void>((r) => (shown = r)),
      deltas: string[] = [];
    const encode = (x: unknown) =>
      new TextEncoder().encode("data: " + JSON.stringify(x) + "\n\n");
    globalThis.fetch = async (_url, init) => {
      const b = JSON.parse(init!.body as string),
        m = JSON.parse(b.messages[1].content);
      assert.equal(m.stem, f.q.stem);
      assert.equal(m.conversation.message, "係数ってどういう意味？");
      if (b.stream) {
        assert.equal(m.solutionForSafetyCheck, undefined);
        assert.equal(JSON.stringify(b).includes(f.q.explanation), false);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              upstream = c;
              c.enqueue(encode({ choices: [{ delta: { content: first } }] }));
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      checks++;
      assert.equal(m.solutionForSafetyCheck.explanation, f.q.explanation);
      assert.ok(m.replyPrefix.startsWith(first));
      if (checks > 1) assert.ok(m.replyPrefix.includes(second));
      return reply(approved);
    };
    try {
      const work = questionChat(
        f.env,
        f.provider,
        f.q,
        { message: "係数ってどういう意味？", history: [] },
        (event) => {
          if ("text" in event) {
            deltas.push(event.text);
            if (!seen) {
              seen = true;
              shown();
            }
          }
        },
      );
      await firstShown;
      assert.equal(checks, 1);
      assert.deepEqual(deltas, [first]);
      upstream.enqueue(
        encode({
          choices: [{ delta: { content: second }, finish_reason: "stop" }],
        }),
      );
      upstream.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      upstream.close();
      assert.equal(await work, first + "\n\n" + second);
      assert.equal(checks, 2);
    } finally {
      globalThis.fetch = original;
      f.sqlite.close();
    }
  },
);
test("generic or unsafe replies are blocked; verified partial text never releases a rejected continuation", async () => {
  for (const failure of ["safe", "relevant"]) {
    const f = await setup(),
      original = globalThis.fetch;
    const deltas: string[] = [];
    globalThis.fetch = async (_url, init) =>
      JSON.parse(init!.body as string).stream
        ? reply(first)
        : reply({ ...approved, [failure]: false });
    try {
      await assert.rejects(
        questionChat(
          f.env,
          f.provider,
          f.q,
          { message: "係数の意味は？", history: [] },
          (e) => {
            if ("text" in e) deltas.push(e.text);
          },
        ),
      );
      assert.deepEqual(deltas, []);
    } finally {
      globalThis.fetch = original;
      f.sqlite.close();
    }
  }
  const f = await setup(),
    original = globalThis.fetch;
  let checks = 0;
  const deltas: string[] = [];
  globalThis.fetch = async (_url, init) =>
    JSON.parse(init!.body as string).stream
      ? reply(first + "\n\n" + second)
      : reply({ ...approved, safe: ++checks === 1 });
  try {
    await assert.rejects(
      questionChat(
        f.env,
        f.provider,
        f.q,
        { message: "係数の意味は？", history: [] },
        (e) => {
          if ("text" in e) deltas.push(e.text);
        },
      ),
    );
    assert.deepEqual(deltas, [first]);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
test("a safe introductory sentence waits for sufficient context instead of aborting a useful answer", async () => {
  const f = await setup(),
    original = globalThis.fetch;
  const intro = "最初に使うのは、式の係数という考え方についての知識です。";
  const explanation =
    "係数とは文字に掛かっている数のことで、たとえば別の式 $3z+1$ では3がzの係数です。";
  let checks = 0;
  const deltas: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const b = JSON.parse(init!.body as string);
    if (b.stream) return reply(intro + "\n\n" + explanation);
    checks++;
    const material = JSON.parse(b.messages[1].content);
    if (checks === 1) {
      assert.equal(deltas.length, 0);
      return reply({ ...approved, useful: false });
    }
    assert.ok(material.replyPrefix.includes(explanation));
    return reply(approved);
  };
  try {
    const text = await questionChat(
      f.env,
      f.provider,
      f.q,
      { message: "係数を知らない人に具体例で説明して。", history: [] },
      (e) => {
        if ("text" in e) deltas.push(e.text);
      },
    );
    assert.equal(checks, 2);
    assert.equal(deltas.length, 1);
    assert.ok(text.includes(explanation));
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
