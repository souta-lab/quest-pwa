import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index";
import { fixture, seedNewAnswers } from "./d1-fixture";
import { seal } from "../worker/security";
import { mutate, load } from "../worker/repository";
import { schedule, answer } from "../worker/engine";
import { bank } from "../worker/bank";
import {
  configureGeneration,
  fillGenerationBuffer,
  generationStatus,
  nextLiveQuestion,
  retryPlan,
} from "../worker/generation";

async function setup(subjects = ["math1", "english", "physics"]) {
  const f = fixture(),
    id = f.user(),
    sent: { jobId: string }[] = [];
  f.env.GENERATION_QUEUE = {
    send: async (m: { jobId: string }) => {
      sent.push(m);
    },
  } as any;
  const encrypted = await seal("buffer-test-key", f.env);
  f.sqlite
    .prepare(
      "INSERT INTO provider_configs(user_id,format,base_url,model,ciphertext,iv) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      "openai",
      "https://buffer.example.invalid/v1",
      "writer",
      encrypted.ciphertext,
      encrypted.iv,
    );
  await mutate(f.env, id, (s) => {
    s.subjects = subjects;
  });
  await configureGeneration(f.env, id, {
    enabled: 1,
    daily_limit: 0,
    verification_model: "verifier",
  });
  const original = globalThis.fetch;
  let calls = 0,
    serial = 0,
    reject = false;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const b = JSON.parse(init!.body as string),
      message = b.messages.at(-1).content;
    if (b.model === "verifier")
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                correct: "b",
                valid: !reject,
                reason: "ローカル検証",
                explanation:
                  "独立検証で求めた解説です。値を比較して判断します。",
                hint: "まず、与えられた条件を式や表に整理してみよう。",
              }),
            },
          },
        ],
      });
    const [, subject, topic, difficulty] = message.match(
      /科目:(.*?)。単元:(.*?)。難度:(\d)\/3/,
    );
    const q = {
      subject,
      topic,
      difficulty: Number(difficulty),
      expectedSeconds: 45,
      stem: `${topic}の検証専用問題その${++serial}。資料に合うものはどれか。`,
      options: [
        { id: "a", text: "候補甲" },
        { id: "b", text: "候補乙" },
        { id: "c", text: "候補丙" },
        { id: "d", text: "候補丁" },
      ],
      correct: "b",
      explanation: "",
      hints: [],
    };
    return Response.json({
      choices: [{ message: { content: JSON.stringify(q) } }],
    });
  };
  let cursor = 0;
  async function drain() {
    while (cursor < sent.length) {
      assert.ok(cursor < 100, "refill must stop at five upcoming questions");
      const message = sent[cursor++];
      await worker.queue(
        { messages: [{ body: message, ack() {} }] } as any,
        f.env,
      );
    }
  }
  return {
    ...f,
    id,
    sent,
    drain,
    calls: () => calls,
    reject: () => {
      reject = true;
    },
    close: () => {
      globalThis.fetch = original;
      f.sqlite.close();
    },
  };
}

test("five verified upcoming questions fill once, balance subjects, and refill after use", async () => {
  const f = await setup();
  try {
    await Promise.all([
      fillGenerationBuffer(f.env, f.id),
      fillGenerationBuffer(f.env, f.id),
      fillGenerationBuffer(f.env, f.id),
    ]);
    assert.equal(f.sent.length, 1);
    await f.drain();
    let g = await generationStatus(f.env, f.id);
    assert.deepEqual(g.buffer, { target: 5, ready: 5, pending: 0, failed: 0 });
    assert.equal(f.calls(), 10);
    const ready = f.sqlite
      .prepare(
        "SELECT subject,topic,question_id FROM generation_plans WHERE state='ready' ORDER BY rowid",
      )
      .all() as any[];
    assert.equal(new Set(ready.map((p) => p.question_id)).size, 5);
    const counts = [...new Set(ready.map((p) => p.subject))].map(
      (s) => ready.filter((p) => p.subject === s).length,
    );
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    for (const subject of ["math1", "english", "physics"])
      assert.equal(
        new Set(ready.filter((p) => p.subject === subject).map((p) => p.topic))
          .size,
        ready.filter((p) => p.subject === subject).length,
      );
    await fillGenerationBuffer(f.env, f.id);
    await worker.queue(
      { messages: [{ body: f.sent[0], ack() {} }] } as any,
      f.env,
    );
    assert.equal(f.calls(), 10);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM review_cards").get()!.n,
      0,
    );
    assert.equal((await load(f.env, f.id)).state.xp, 0);
    const current = await nextLiveQuestion(f.env, f.id);
    assert.ok(current && !("waiting" in current));
    await fillGenerationBuffer(f.env, f.id);
    await f.drain();
    g = await generationStatus(f.env, f.id);
    assert.equal(g.buffer.ready, 5);
    assert.equal(f.calls(), 12);
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM generation_plans WHERE state IN ('ready','pending','failed')",
        )
        .get()!.n,
      5,
    );
    assert.equal(JSON.stringify(g).includes('"correct"'), false);
  } finally {
    f.close();
  }
});

test("D1 enforces the five-plan ceiling even when callers bypass application checks", async () => {
  const f = await setup();
  try {
    for (let n = 0; n < 6; n++)
      f.sqlite
        .prepare(
          "INSERT INTO generation_plans(id,user_id,request_id,subject,basic_ranges,basic_range,topic,difficulty,state,source,question_id,created_at) VALUES(?,?,?,'math1','[]',NULL,'二次関数',1,'ready','generated',NULL,0)",
        )
        .run("cap-" + n, f.id, "request-" + n);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) n FROM generation_plans WHERE user_id=?")
        .get(f.id)!.n,
      5,
    );
  } finally {
    f.close();
  }
});

test("future review positions include queued new questions without changing FSRS due dates", async () => {
  const f = await setup(["math1"]),
    due = Date.now() - 86400000;
  try {
    seedNewAnswers(f, f.id, 9, Date.now() - 100000);
    await mutate(f.env, f.id, (s) => {
      const q = bank.find((q) => q.subject === "math1")!;
      s.cards[q.id] = { ...schedule(null, due, true), due: new Date(due) };
    });
    await fillGenerationBuffer(f.env, f.id);
    await f.drain();
    const plans = f.sqlite
      .prepare(
        "SELECT source FROM generation_plans WHERE state='ready' ORDER BY rowid",
      )
      .all();
    assert.equal(plans.length, 5);
    assert.equal(plans.filter((p) => p.source === "review").length, 1);
    assert.equal(
      f.sqlite.prepare("SELECT MIN(due) d FROM review_cards").get()!.d,
      due,
    );
  } finally {
    f.close();
  }
});

test("consuming a five-question buffer preserves interleaving and never repeats a review consecutively", async () => {
  const f = await setup(["math1"]),
    now = Date.now();
  try {
    seedNewAnswers(f, f.id, 9, now - 100000);
    await mutate(f.env, f.id, (s) => {
      for (const q of bank.filter((q) => q.subject === "math1"))
        s.cards[q.id] = {
          ...schedule(null, now - 86400000, true),
          due: new Date(now - 86400000),
        };
    });
    let lastReview = -10,
      reviews = 0;
    await fillGenerationBuffer(f.env, f.id);
    await f.drain();
    for (let n = 0; n < 30; n++) {
      const current = await nextLiveQuestion(f.env, f.id, true);
      assert.ok(current && !("waiting" in current));
      if (!current || "waiting" in current)
        throw Error("buffer unexpectedly empty");
      if (current.dueReview) {
        assert.ok(n - lastReview >= 3);
        lastReview = n;
        reviews++;
      }
      const q = JSON.parse(
        f.sqlite
          .prepare("SELECT data FROM question_catalog WHERE id=?")
          .get(current.questionId)!.data as string,
      );
      await mutate(f.env, f.id, (s) => answer(s, current.id, q.correct));
      await fillGenerationBuffer(f.env, f.id);
      await f.drain();
    }
    assert.equal(reviews, bank.filter((q) => q.subject === "math1").length);
  } finally {
    f.close();
  }
});

test("a refill failure preserves already verified questions and stops further paid attempts", async () => {
  const f = await setup();
  try {
    await fillGenerationBuffer(f.env, f.id);
    await worker.queue(
      { messages: [{ body: f.sent[0], ack() {} }] } as any,
      f.env,
    );
    f.reject();
    await f.drain();
    const before = f.calls();
    await fillGenerationBuffer(f.env, f.id);
    assert.equal(f.calls(), before);
    const g = await generationStatus(f.env, f.id);
    assert.equal(g.buffer.ready, 1);
    assert.equal(g.buffer.failed, 1);
    const current = await nextLiveQuestion(f.env, f.id);
    assert.ok(current && !("waiting" in current));
  } finally {
    f.close();
  }
});
