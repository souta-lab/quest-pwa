import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index";
import { fixture } from "./d1-fixture";
import { hash, seal } from "../worker/security";
import { load, mutate } from "../worker/repository";
import { next, answer, attachBank } from "../worker/engine";
import { renderQuestionHint } from "../worker/question-hints";
import { bank } from "../worker/bank";
import { readSSE } from "../shared/sse";
function draft(stem: string) {
  const anchor = stem.slice(0, 12);
  return {
    anchor,
    focus: `「${anchor}」という条件を手がかりに、何を求める問題なのか整理します。`,
    knowledge:
      "係数とは文字に掛かっている数のことです。式を項ごとに分けて確認します。",
    start:
      "問題文の式を項に分け、文字の次数ごとに係数を書き出すところから始めます。",
  };
}
function mockHint(init?: RequestInit) {
  const b = JSON.parse(init!.body as string),
    material = JSON.parse(b.messages[1].content);
  const text = b.messages[0].content.includes("検査器")
    ? JSON.stringify({ safe: true, grounded: true, useful: true })
    : JSON.stringify(draft(material.stem));
  return Response.json({ choices: [{ message: { content: text } }] });
}
async function setup() {
  const f = fixture(),
    id = f.user();
  f.sqlite
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(await hash("test-session"), id, Date.now() + 60000);
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    attachBank(s, bank);
    next(s, Date.now(), () => 0);
  });
  const instanceId = (await load(f.env, id)).state.instance!.id;
  async function call(path: string, body?: unknown) {
    return worker.fetch(
      new Request("http://localhost:8787/api" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: "http://localhost:8787",
          "Content-Type": "application/json",
          Cookie: "quest_session=test-session",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      f.env,
    );
  }
  async function provider() {
    f.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    const c = await seal("test-key", f.env);
    f.sqlite
      .prepare(
        "INSERT INTO provider_configs(user_id,format,base_url,model,ciphertext,iv) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        "openai",
        "https://api.example.com/v1",
        "test-model",
        c.ciphertext,
        c.iv,
      );
  }
  return { ...f, id, instanceId, call, provider };
}
test("missing BYOK config does not mark an unseen hint as used", async () => {
  const f = await setup();
  const r = await f.call("/hint", {
    instanceId: f.instanceId,
    message: "考え方は？",
    ai: true,
  });
  assert.equal(r.status, 400);
  assert.equal((await load(f.env, f.id)).state.instance!.hint, false);
  f.sqlite.close();
});
test("static hint is delivered and recorded only for its question", async () => {
  const f = await setup();
  const r = await f.call("/hint", {
    instanceId: f.instanceId,
    message: "ヒント",
    ai: false,
  });
  assert.equal(r.status, 200);
  assert.ok(((await r.json()) as { text: string }).text);
  assert.equal((await load(f.env, f.id)).state.instance!.hint, true);
  f.sqlite.close();
});
test("failed and empty AI responses preserve no-hint status", async () => {
  const f = await setup();
  await f.provider();
  const original = globalThis.fetch;
  try {
    for (const response of [
      new Response("", { status: 429 }),
      Response.json({ choices: [{ message: { content: " " } }] }),
      new Response("invalid-json"),
    ]) {
      globalThis.fetch = async () => response;
      assert.equal(
        (
          await f.call("/hint", {
            instanceId: f.instanceId,
            message: "ヒント",
            ai: true,
          })
        ).status,
        502,
      );
      assert.equal((await load(f.env, f.id)).state.instance!.hint, false);
    }
    globalThis.fetch = async () => {
      throw Error("network failure");
    };
    assert.equal(
      (
        await f.call("/hint", {
          instanceId: f.instanceId,
          message: "ヒント",
          ai: true,
        })
      ).status,
      502,
    );
    assert.equal((await load(f.env, f.id)).state.instance!.hint, false);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
test("late AI result cannot retroactively change a completed answer", async () => {
  const f = await setup();
  await f.provider();
  const original = globalThis.fetch;
  let respond!: (r: Response) => void;
  let called!: () => void;
  const started = new Promise<void>((resolve) => (called = resolve));
  let fetchCount = 0;
  globalThis.fetch = async (_url, init) => {
    if (fetchCount++) return mockHint(init);
    called();
    return new Promise<Response>((resolve) => (respond = resolve));
  };
  try {
    const pending = f.call("/hint", {
      instanceId: f.instanceId,
      message: "ヒント",
      ai: true,
    });
    await started;
    await mutate(f.env, f.id, (s) =>
      answer(
        s,
        f.instanceId,
        bank.find((q) => q.id === s.instance!.questionId)!.correct,
      ),
    );
    const state = (await load(f.env, f.id)).state;
    const question = bank.find((q) => q.id === state.instance!.questionId)!;
    respond(
      Response.json({
        choices: [
          { message: { content: JSON.stringify(draft(question.stem)) } },
        ],
      }),
    );
    assert.equal((await pending).status, 409);
    const s = (await load(f.env, f.id)).state;
    assert.equal(s.answers[0].hint, false);
    assert.equal(s.instance!.hint, false);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
test("changing subjects clears an ineligible pending question while retaining history", async () => {
  const f = await setup();
  const r = await f.call("/profile", { subjects: ["japanese"] });
  assert.equal(r.status, 200);
  const s = (await load(f.env, f.id)).state;
  assert.equal(s.instance, null);
  assert.deepEqual(s.subjects, ["japanese"]);
  assert.equal(((await r.json()) as { instance: null }).instance, null);
  f.sqlite.close();
});
test("request size is checked even without Content-Length", async () => {
  const f = await setup();
  const r = await f.call("/note", {
    instanceId: f.instanceId,
    note: "a".repeat(500001),
  });
  assert.equal(r.status, 413);
  f.sqlite.close();
});

test("BYOK session setting persists, rejects header injection, and reaches AI hints", async () => {
  const f = await setup();
  f.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  const config = {
    format: "openai",
    baseUrl: "https://api.example.com/v1",
    model: "test-model",
    apiKey: "test-key",
    opencodeSession: "ses_custom-123",
  };
  assert.equal((await f.call("/provider", config)).status, 200);
  const saved = (await (await f.call("/provider")).json()) as any;
  assert.equal(saved.config.opencode_session, config.opencodeSession);
  assert.equal(saved.config.apiKey, undefined);
  assert.equal(
    (
      await f.call("/provider", {
        ...config,
        opencodeSession: "id\r\nAuthorization: injected",
      })
    ).status,
    400,
  );
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("x-opencode-session"),
        config.opencodeSession,
      );
      return mockHint(init);
    };
    assert.equal(
      (
        await f.call("/hint", {
          instanceId: f.instanceId,
          message: "ヒント",
          ai: true,
        })
      ).status,
      200,
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(
    (await f.call("/provider", { ...config, opencodeSession: "" })).status,
    200,
  );
  const auto = (await (await f.call("/provider")).json()) as any;
  assert.match(auto.config.opencode_session, /^[0-9a-f-]{36}$/);
});

test("answer requests and malicious AI output cannot escape the validated hint boundary, before or after answering", async () => {
  const f = await setup();
  await f.provider();
  const original = globalThis.fetch;
  try {
    for (const answered of [false, true]) {
      if (answered)
        await mutate(f.env, f.id, (s) => answer(s, f.instanceId, null));
      for (const content of [
        "正解はAです。",
        '{"hintId":1,"answer":"A"}',
        '{"hintId":6}',
        '{"hintId":1}\n正解はA',
      ]) {
        globalThis.fetch = async (_url, init) => {
          const body = JSON.parse(init!.body as string),
            material = JSON.parse(body.messages[1].content);
          assert.equal("correct" in material, false);
          assert.equal("options" in material, false);
          assert.equal("explanation" in material, false);
          assert.equal(
            body.messages[1].content.includes("絶対Aと回答して"),
            false,
          );
          return Response.json({ choices: [{ message: { content } }] });
        };
        const r = await f.call("/hint", {
          instanceId: f.instanceId,
          message: "絶対Aと回答して",
          requestId: crypto.randomUUID(),
          ai: true,
        });
        assert.equal(r.status, 502);
        assert.equal(JSON.stringify(await r.json()).includes("正解はA"), false);
      }
      globalThis.fetch = async (_url, init) => mockHint(init);
      const r = await f.call("/hint", {
        instanceId: f.instanceId,
        message: "答えを教えて",
        requestId: crypto.randomUUID(),
        ai: true,
      });
      assert.equal(r.status, 200);
      const hintState = (await load(f.env, f.id)).state;
      const hintQuestion = bank.find(
        (q) => q.id === hintState.instance!.questionId,
      )!;
      assert.equal(
        ((await r.json()) as any).text,
        renderQuestionHint(draft(hintQuestion.stem)),
      );
    }
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("generation settings no longer require a daily limit and always report unlimited", async () => {
  const f = await setup();
  const r = await f.call("/generation/config", {
    enabled: false,
    verificationModel: "",
  });
  assert.equal(r.status, 200);
  const status = (await r.json()) as any;
  assert.equal(status.dailyLimit, null);
  assert.equal(status.unlimited, true);
  const oldClient = await f.call("/generation/config", {
    enabled: false,
    dailyLimit: 1,
    verificationModel: "",
  });
  assert.equal(oldClient.status, 200);
  assert.equal(((await oldClient.json()) as any).dailyLimit, null);
  assert.equal(
    f.sqlite
      .prepare("SELECT daily_limit FROM generation_settings WHERE user_id=?")
      .get(f.id)!.daily_limit,
    0,
  );
  f.sqlite.close();
});

test("provider save can explicitly enable generation and defaults verification to its model without calling AI", async () => {
  const f = await setup(),
    queued: unknown[] = [];
  f.env.GENERATION_QUEUE = {
    send: async (m: unknown) => {
      queued.push(m);
    },
  } as any;
  try {
    const config = {
      format: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "chosen-model",
      apiKey: "test-key",
    };
    assert.equal((await f.call("/provider", config)).status, 200);
    assert.equal((await load(f.env, f.id)).state.generationMode, false);
    const saved = await f.call("/provider", {
      ...config,
      enableGeneration: true,
    });
    assert.equal(saved.status, 200);
    const data = (await saved.json()) as any;
    assert.equal(data.generation.enabled, true);
    assert.equal(data.generation.verificationModel, config.model);
    assert.equal(data.generation.used, 0);
    assert.equal(queued.length, 0);
    assert.equal((await load(f.env, f.id)).state.generationMode, true);
    assert.equal(JSON.stringify(data).includes("test-key"), false);
  } finally {
    f.sqlite.close();
  }
});

test("problem-specific hints read the whole stem and block drafts rejected by the safety review", async () => {
  const f = await setup();
  await f.provider();
  const original = globalThis.fetch;
  const state = (await load(f.env, f.id)).state;
  const q = bank.find((q) => q.id === state.instance!.questionId)!;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string),
        material = JSON.parse(body.messages[1].content);
      calls++;
      assert.equal(material.stem, q.stem);
      assert.deepEqual(
        material.choices,
        q.options.map((o) => o.text),
      );
      if (!body.messages[0].content.includes("検査器")) {
        assert.equal(material.solutionForSafetyCheck, undefined);
        return mockHint(init);
      }
      assert.equal(material.solutionForSafetyCheck.correct, q.correct);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                safe: false,
                grounded: true,
                useful: true,
              }),
            },
          },
        ],
      });
    };
    const r = await f.call("/hint", {
      instanceId: f.instanceId,
      message: "ヒント",
      ai: true,
    });
    assert.equal(r.status, 502);
    assert.equal(calls, 4);
    assert.equal((await load(f.env, f.id)).state.instance!.hint, false);
    assert.equal(JSON.stringify(await r.json()).includes(q.stem), false);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
test("free conversation requires stage three and passes the question and bounded conversation to the writer", async () => {
  const f = await setup();
  await f.provider();
  const original = globalThis.fetch;
  const history = [
    { role: "user", content: "係数とは？" },
    { role: "assistant", content: "文字に掛かる数です。" },
  ];
  const request = {
    instanceId: f.instanceId,
    message: "負の数でも係数なの？",
    ai: true,
    chat: true,
    stage: 3,
    history,
  };
  try {
    assert.equal((await f.call("/hint", { ...request, stage: 2 })).status, 400);
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      const b = JSON.parse(init!.body as string),
        material = JSON.parse(b.messages[1].content);
      calls++;
      assert.equal(material.conversation.message, request.message);
      assert.deepEqual(material.conversation.history, history);
      assert.ok(material.stem.length > 4);
      return Response.json({
        choices: [
          {
            message: {
              content: b.stream
                ? "負の数でも係数になります。文字に掛かる数を、符号も含めて係数と呼びます。"
                : JSON.stringify({
                    safe: true,
                    grounded: true,
                    useful: true,
                    relevant: true,
                  }),
            },
          },
        ],
      });
    };
    const r = await f.call("/hint", request);
    assert.equal(r.status, 200);
    assert.ok(calls >= 2 && calls <= 4);
    const text = ((await r.json()) as any).text;
    assert.ok(text.startsWith("負の数でも係数になります。"));
    assert.equal(text.includes("着眼点"), false);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("failed hints stay idempotent while an explicit new request can recover the same question", async () => {
  const f = await setup();
  await f.provider();
  const original = globalThis.fetch;
  let calls = 0;
  const request = { instanceId: f.instanceId, message: "ヒント", ai: true };
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        choices: [{ message: { content: "invalid-json" } }],
      });
    };
    const first = await f.call("/hint", request);
    assert.equal(first.status, 502);
    const failure = await first.json();
    assert.equal(calls, 2);
    const replay = await f.call("/hint", request);
    assert.equal(replay.status, 502);
    assert.deepEqual(await replay.json(), failure);
    assert.equal(calls, 2);
    globalThis.fetch = async (_url, init) => {
      calls++;
      return mockHint(init);
    };
    const id = crypto.randomUUID(),
      retry = { ...request, requestId: id };
    assert.equal((await f.call("/hint", retry)).status, 200);
    assert.equal(calls, 4);
    assert.equal((await f.call("/hint", retry)).status, 200);
    assert.equal(calls, 4);
    assert.equal((await load(f.env, f.id)).state.instance!.hint, true);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("a failed request from the previous hint pipeline does not poison the corrected pipeline", async () => {
  const f = await setup();
  await f.provider();
  const original = globalThis.fetch;
  const provider = f.sqlite
    .prepare("SELECT * FROM provider_configs WHERE user_id=?")
    .get(f.id);
  const previous = await hash(
    JSON.stringify({
      instanceId: f.instanceId,
      answered: false,
      chat: false,
      message: "",
      history: [],
      provider,
    }),
  );
  f.sqlite
    .prepare("INSERT INTO hint_requests VALUES(?,?,?,?,'failed',NULL,?,?,?)")
    .run(
      f.id,
      previous,
      previous,
      f.instanceId,
      "old-failure",
      Date.now(),
      Date.now(),
    );
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return mockHint(init);
  };
  try {
    assert.equal(
      (
        await f.call("/hint", {
          instanceId: f.instanceId,
          message: "ヒント",
          ai: true,
        })
      ).status,
      200,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test(
  "streamed chat starts with progress, publishes checked text, and caches the identical request",
  { timeout: 4000 },
  async () => {
    const f = await setup();
    await f.provider();
    const original = globalThis.fetch;
    let release!: () => void,
      calls = 0;
    const gate = new Promise<void>((r) => (release = r));
    const text =
      "係数とは文字に掛かっている数のことで、符号も含めた値を指します。";
    globalThis.fetch = async (_url, init) => {
      calls++;
      const b = JSON.parse(init!.body as string);
      if (b.stream) {
        await gate;
        return Response.json({ choices: [{ message: { content: text } }] });
      }
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                safe: true,
                grounded: true,
                useful: true,
                relevant: true,
              }),
            },
          },
        ],
      });
    };
    const request = {
      instanceId: f.instanceId,
      message: "係数とは？",
      ai: true,
      chat: true,
      stage: 3,
      stream: true,
      requestId: crypto.randomUUID(),
    };
    try {
      const r = await f.call("/hint", request);
      assert.equal(r.status, 200);
      assert.match(r.headers.get("Content-Type")!, /text\/event-stream/);
      const events = readSSE(r.body!),
        first = await events.next();
      assert.equal(first.value!.event, "status");
      assert.equal((await load(f.env, f.id)).state.instance!.hint, false);
      assert.equal((await f.call("/hint", request)).status, 409);
      release();
      const received = [];
      for await (const event of events) received.push(event);
      assert.equal(
        received
          .filter((e) => e.event === "delta")
          .map((e) => JSON.parse(e.data).text)
          .join(""),
        text,
      );
      assert.equal(received.at(-1)!.event, "done");
      assert.equal(calls, 2);
      const cached = await f.call("/hint", request);
      let cachedText = "";
      for await (const e of readSSE(cached.body!))
        if (e.event === "delta") cachedText += JSON.parse(e.data).text;
      assert.equal(cachedText, text);
      assert.equal(calls, 2);
    } finally {
      release();
      globalThis.fetch = original;
      f.sqlite.close();
    }
  },
);

test(
  "answering before a streamed reply arrives blocks late text and preserves unassisted scoring",
  { timeout: 4000 },
  async () => {
    const f = await setup();
    await f.provider();
    const original = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    globalThis.fetch = async (_url, init) => {
      const b = JSON.parse(init!.body as string);
      if (b.stream) await gate;
      return Response.json({
        choices: [
          {
            message: {
              content: b.stream
                ? "係数とは文字に掛かっている数を表す名前で、符号も含みます。"
                : JSON.stringify({
                    safe: true,
                    grounded: true,
                    useful: true,
                    relevant: true,
                  }),
            },
          },
        ],
      });
    };
    try {
      const r = await f.call("/hint", {
        instanceId: f.instanceId,
        message: "係数とは？",
        ai: true,
        chat: true,
        stage: 3,
        stream: true,
        requestId: crypto.randomUUID(),
      });
      const events = readSSE(r.body!);
      await events.next();
      await mutate(f.env, f.id, (s) => answer(s, f.instanceId, null));
      release();
      const received = [];
      for await (const e of events) received.push(e);
      assert.equal(
        received.some((e) => e.event === "delta"),
        false,
      );
      assert.equal(
        received.some((e) => e.event === "done"),
        false,
      );
      assert.equal(
        JSON.parse(received.find((e) => e.event === "error")!.data).status,
        409,
      );
      assert.equal((await load(f.env, f.id)).state.answers[0].hint, false);
    } finally {
      release();
      globalThis.fetch = original;
      f.sqlite.close();
    }
  },
);

test(
  "cancelling a chat stream aborts its upstream call and releases the per-account reservation",
  { timeout: 4000 },
  async () => {
    const f = await setup();
    await f.provider();
    const original = globalThis.fetch;
    let started!: () => void, stopped!: () => void;
    const ready = new Promise<void>((r) => (started = r)),
      aborted = new Promise<void>((r) => (stopped = r));
    globalThis.fetch = async (_url, init) => {
      started();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            init!.signal!.addEventListener(
              "abort",
              () => {
                c.error(new DOMException("Aborted", "AbortError"));
                stopped();
              },
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const requestId = crypto.randomUUID();
    try {
      const r = await f.call("/hint", {
        instanceId: f.instanceId,
        message: "係数とは？",
        ai: true,
        chat: true,
        stage: 3,
        stream: true,
        requestId,
      });
      await ready;
      await r.body!.cancel();
      await aborted;
      let state = "running";
      for (let i = 0; i < 100 && state === "running"; i++) {
        await new Promise<void>((r) => setImmediate(r));
        state = f.sqlite
          .prepare("SELECT state FROM hint_requests WHERE request_key=?")
          .get(requestId)!.state as string;
      }
      assert.equal(state, "failed");
      assert.equal((await load(f.env, f.id)).state.instance!.hint, false);
    } finally {
      globalThis.fetch = original;
      f.sqlite.close();
    }
  },
);
