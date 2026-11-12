import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, seedNewAnswers } from "./d1-fixture";
import { bank } from "../worker/bank";
import { seal } from "../worker/security";
import { mutate, load } from "../worker/repository";
import { answer, schedule } from "../worker/engine";
import { chooseBrief } from "../worker/question-variety";
import {
  configureGeneration,
  ensurePlan,
  runGeneration,
  nextLiveQuestion,
  generationStatus,
  reportGenerated,
  retryPlan,
} from "../worker/generation";
async function setup(limit = 20) {
  const f = fixture(),
    id = f.user(),
    sent: { jobId: string }[] = [];
  f.env.GENERATION_QUEUE = {
    send: async (message: { jobId: string }) => {
      sent.push(message);
    },
  } as unknown as Queue<{ jobId: string }>;
  f.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  const sealed = await seal("generation-test-key", f.env);
  f.sqlite
    .prepare(
      "INSERT INTO provider_configs(user_id,format,base_url,model,ciphertext,iv) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      "openai",
      "https://api.example.com/v1",
      "generate-model",
      sealed.ciphertext,
      sealed.iv,
    );
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  await configureGeneration(f.env, id, {
    enabled: 1,
    daily_limit: limit,
    verification_model: "verify-model",
  });
  return { ...f, id, sent };
}
test("saved questions are reused only when their complete recipe matches, with private ownership preserved", async () => {
  for (const kind of [
    "matching",
    "other-focus",
    "foreign-owner",
    "unlinked-course",
  ] as const) {
    const f = await setup();
    try {
      const brief = await chooseBrief(f.env, f.id, "math1", "数と式", () => 0);
      if (kind === "unlinked-course")
        await mutate(f.env, f.id, (s) => {
          s.course.active = {
            subject: "math1",
            topic: "数と式",
            lesson: brief.focus,
          };
        });
      const owner = kind === "foreign-owner" ? f.user("private-writer") : f.id;
      const q = {
        ...bank.find((q) => q.subject === "math1")!,
        id: "saved-recipe",
        subject: "math1",
        topic: "数と式",
        difficulty: 1,
        generation: {
          status: "machine_checked",
          model: "test",
          verificationModel: "test",
          checkedAt: 0,
          ...brief,
          ...(kind === "other-focus" ? { focus: "different-target" } : {}),
        },
      };
      f.sqlite
        .prepare(
          "INSERT INTO question_catalog(id,subject,topic,version,data,owner_user_id,sharing_status) VALUES(?,'math1','数と式',1,?,?,'pending')",
        )
        .run(q.id, JSON.stringify(q), owner);
      await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
      const status = await generationStatus(f.env, f.id);
      const saved = f.sqlite
        .prepare("SELECT question_id FROM generation_plans WHERE id=?")
        .get(status.plan!.id)!;
      if (kind === "matching") {
        assert.equal(status.plan!.state, "ready");
        assert.equal(saved.question_id, q.id);
        assert.equal(f.sent.length, 0);
      } else {
        assert.equal(status.plan!.state, "pending");
        assert.equal(saved.question_id, null);
        assert.equal(f.sent.length, 1);
      }
    } finally {
      f.sqlite.close();
    }
  }
});
test("the writer and independent solver receive the actual taught knowledge and worked method, and old focus-only drafts cannot count as linked practice", async () => {
  const f = await setup();
  const original = globalThis.fetch;
  let calls = 0;
  try {
    await mutate(f.env, f.id, (s) => {
      s.course.active = {
        subject: "math1",
        topic: "数と式",
        lesson: "等式の変形",
      };
    });
    await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
    const p = (await generationStatus(f.env, f.id)).plan!;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(init!.body as string),
        prompt = body.messages.at(-1).content;
      assert.ok(prompt.includes("等式は左右が同じ値"));
      assert.ok(prompt.includes("$3x+5=17$"));
      if (body.model === "verify-model")
        assert.ok(prompt.includes("4選択肢全て"));
      const q = {
        subject: "math1",
        topic: "数と式",
        stem: "$3x-2=16$ を満たすxの値を求める。",
        options: [
          { id: "a", text: "4" },
          { id: "b", text: "6" },
          { id: "c", text: "8" },
          { id: "d", text: "10" },
        ],
        correct: "b",
        difficulty: 1,
        expectedSeconds: 45,
      };
      const content =
        body.model === "verify-model"
          ? {
              valid: true,
              correct: "b",
              reason: "教材の等式変形だけで解け、正解は一つ",
              explanation: "両辺に2を足して3x=18。両辺を3で割るとx=6。",
              hint: "左右へ同じ操作を行って文字の項を残す。",
            }
          : q;
      return Response.json({
        choices: [{ message: { content: JSON.stringify(content) } }],
      });
    };
    await runGeneration(f.env, p.id);
    assert.equal(calls, 2);
    const raw = f.sqlite
      .prepare(
        "SELECT q.data FROM question_catalog q JOIN generation_plans p ON p.question_id=q.id WHERE p.id=?",
      )
      .get(p.id)!;
    assert.equal(
      JSON.parse(String(raw.data)).generation.teachingVersion,
      "course-1",
    );
    const instance = await nextLiveQuestion(f.env, f.id);
    assert.ok(instance && !("waiting" in instance));
    assert.equal(instance.courseLesson, "math1/数と式/等式の変形");
    assert.equal("teachingVersion" in instance.question.generation!, false);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
test("a due backlog offers saved retrieval before charging for another question", async () => {
  const f = await setup(),
    now = Date.now();
  await mutate(f.env, f.id, (s) => {
    for (const q of bank.filter((q) => q.subject === "math1"))
      s.cards[q.id] = {
        ...schedule(null, now - 86400000, true),
        due: new Date(now - 86400000),
      };
  });
  await ensurePlan(f.env, f.id, crypto.randomUUID(), now, () => 0);
  const plan = (await generationStatus(f.env, f.id)).plan!;
  assert.equal(plan.source, "review");
  assert.equal(plan.state, "ready");
  assert.equal(f.sent.length, 0);
  assert.equal(
    f.sqlite.prepare("SELECT MIN(due) AS due FROM review_cards").get()!.due,
    now - 86400000,
  );
  f.sqlite.close();
});
test("guided generation keeps its teaching objective and varies the format; buffered later problems progress to application", async () => {
  const f = await setup();
  try {
    await mutate(f.env, f.id, (s) => {
      s.course.active = {
        subject: "math1",
        topic: "集合と命題",
        lesson: "対偶と反例",
      };
    });
    await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
    const plan = f.sqlite
      .prepare("SELECT * FROM generation_plans WHERE user_id=?")
      .get(f.id)!;
    assert.equal(plan.topic, "集合と命題");
    assert.equal(plan.focus, "対偶と反例");
    assert.equal(plan.purpose, "practice");
    const brief = await chooseBrief(
      f.env,
      f.id,
      "math1",
      "集合と命題",
      () => 0,
      "対偶と反例",
    );
    assert.equal(brief.focus, plan.focus);
    assert.notEqual(brief.approach, plan.approach);
    assert.notEqual(brief.scenario, plan.scenario);
    // A cancelled old route must not start even its writer call.
    await mutate(f.env, f.id, (s) => {
      s.course.active = {
        subject: "math1",
        topic: "二次関数",
        lesson: "平方完成と頂点",
      };
    });
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error("must not call");
    };
    try {
      await runGeneration(f.env, String(plan.id));
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calls, 0);
    assert.equal(
      f.sqlite
        .prepare("SELECT state FROM generation_plans WHERE id=?")
        .get(plan.id)!.state,
      "cancelled",
    );
  } finally {
    f.sqlite.close();
  }
});
function fake(f: Awaited<ReturnType<typeof setup>>, kind = "ok") {
  const calls: { body: any; headers: Headers }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    calls.push({ body, headers: new Headers(init!.headers) });
    const p = f.sqlite
      .prepare("SELECT * FROM generation_plans WHERE state='pending'")
      .get() as {
      id: string;
      subject: string;
      topic: string;
      difficulty: number;
    };
    const starter = bank.find((q) => q.subject === p.subject)!;
    const q = {
      ...starter,
      stem: starter.stem + "（生成テスト専用:" + p.id + "）",
      subject: p.subject,
      topic: p.topic,
      difficulty: p.difficulty,
    };
    const isVerify = body.model === "verify-model";
    const value = isVerify
      ? {
          valid: kind !== "wrong",
          correct: kind === "wrong" ? "impossible" : q.correct,
          reason: "別呼び出しのテスト検証",
          explanation: "テスト検証者から返る十分な長さの解説です。",
          hint: "まず、条件と定義を整理してみよう。",
        }
      : {
          ...q,
          ...(kind === "null-range" ? { basicRange: null } : {}),
          ...(kind === "invalid-time" ? { expectedSeconds: 200 } : {}),
        };
    const text =
      !isVerify &&
      (kind === "malformed" || (kind === "repair-once" && calls.length === 1))
        ? "not json"
        : JSON.stringify(value);
    return Response.json({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 50, completion_tokens: 100 },
    });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
test("prefetch and duplicate requests reserve one job and one queue message", async () => {
  const f = await setup(),
    request = crypto.randomUUID();
  await Promise.all([
    ensurePlan(f.env, f.id, request),
    ensurePlan(f.env, f.id, crypto.randomUUID()),
  ]);
  await ensurePlan(f.env, f.id, request);
  assert.equal(f.sent.length, 1);
  assert.equal((await generationStatus(f.env, f.id)).used, 1);
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM generation_plans").get()!.n,
    1,
  );
  f.sqlite.close();
});
test("validated shared question is persisted, served safely, and queue replay costs no extra calls", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(mock.calls.length, 2);
    const writerMessages = mock.calls[0].body.messages;
    assert.equal(writerMessages.length, 22);
    assert.equal(
      writerMessages.filter((m: any) => m.role === "assistant").length,
      10,
    );
    assert.equal(JSON.parse(writerMessages[2].content).subject, "math1");
    assert.ok(writerMessages.at(-1).content.startsWith("科目:math1。単元:"));
    assert.equal(mock.calls[1].body.messages.length, 2);
    assert.equal(
      mock.calls[0].headers.get("Authorization"),
      "Bearer generation-test-key",
    );
    const verifyPrompt = mock.calls[1].body.messages[1].content;
    assert.equal(verifyPrompt.includes('"correct"'), false);
    assert.equal(verifyPrompt.includes('"explanation"'), false);
    assert.equal(verifyPrompt.includes('"hints"'), false);
    const status = await generationStatus(f.env, f.id);
    assert.equal(status.plan!.state, "ready");
    assert.equal(status.inputTokens, 100);
    assert.equal(status.outputTokens, 200);
    const result = await nextLiveQuestion(f.env, f.id);
    assert.ok(result && !("waiting" in result));
    if (!result || "waiting" in result) throw Error("not ready");
    assert.equal(result.question.options.length, 4);
    assert.equal("correct" in result.question, false);
    assert.ok(result.question.generation);
    assert.equal(result.question.source.includes("人による校閲なし"), true);
    assert.equal(
      ((await nextLiveQuestion(f.env, f.id, true)) as typeof result)!.id,
      result.id,
    );
    const row = f.sqlite
      .prepare("SELECT owner_user_id,data FROM question_catalog WHERE id=?")
      .get(result.questionId)!;
    assert.equal(row.owner_user_id, f.id);
    assert.equal(
      JSON.parse(row.data as string).explanation,
      "テスト検証者から返る十分な長さの解説です。",
    );
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("FSRS review uses the saved generated question without another model call", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    const first = await nextLiveQuestion(f.env, f.id);
    if (!first || "waiting" in first) throw Error("not ready");
    const correct = JSON.parse(
      f.sqlite
        .prepare("SELECT data FROM question_catalog WHERE id=?")
        .get(first.questionId)!.data as string,
    ).correct;
    await mutate(f.env, f.id, (s) => {
      answer(s, first.id, correct, Date.now() - 660000);
      s.cards[first.questionId].due = new Date(Date.now() - 1000);
      s.instance!.note = "old note";
      s.instance = null;
    });
    seedNewAnswers(f, f.id, 8, Date.now() - 650000);
    await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
    const review = await nextLiveQuestion(f.env, f.id, true);
    if (!review || "waiting" in review) throw Error("not ready");
    assert.equal(review.questionId, first.questionId);
    assert.equal(review.question.stem, first.question.stem);
    assert.equal(review.dueReview, true);
    assert.equal(review.note, "");
    assert.notEqual(review.id, first.id);
    assert.equal(mock.calls.length, 2);
    assert.equal(f.sent.length, 1);
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("disagreed verification quarantines draft and does not retry paid calls automatically", async () => {
  const f = await setup(1);
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f, "wrong");
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    let status = await generationStatus(f.env, f.id);
    assert.equal(status.plan!.state, "failed");
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM question_catalog WHERE owner_user_id=?",
        )
        .get(f.id)!.n,
      0,
    );
    await ensurePlan(f.env, f.id, crypto.randomUUID());
    assert.equal(mock.calls.length, 2);
    assert.equal(f.sent.length, 1);
    await retryPlan(f.env, f.id, status.plan!.id, crypto.randomUUID());
    status = await generationStatus(f.env, f.id);
    assert.equal(status.plan!.state, "pending");
    assert.equal(status.used, 2);
    assert.equal(f.sent.length, 2);
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("malformed question does not reach verification or the published catalog", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f, "malformed");
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(mock.calls.length, 2);
    assert.equal((await generationStatus(f.env, f.id)).plan!.state, "failed");
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM question_catalog WHERE owner_user_id=?",
        )
        .get(f.id)!.n,
      0,
    );
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});

test("an unused null basic range is normalized but invalid time is rejected with a useful field label", async () => {
  for (const kind of ["null-range", "invalid-time"]) {
    const f = await setup();
    await ensurePlan(f.env, f.id, crypto.randomUUID());
    const mock = fake(f, kind);
    try {
      await runGeneration(f.env, f.sent[0].jobId);
      const g = await generationStatus(f.env, f.id);
      assert.equal(g.plan?.state, kind === "null-range" ? "ready" : "failed");
      assert.equal(mock.calls.length, 2);
      if (kind === "invalid-time") assert.match(g.plan!.error!, /想定時間/);
    } finally {
      mock.restore();
      f.sqlite.close();
    }
  }
});
test("one JSON format repair is independently verified and queue replay does not bill it again", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f, "repair-once");
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(mock.calls.length, 3);
    assert.equal(mock.calls[2].body.model, "verify-model");
    const g = await generationStatus(f.env, f.id);
    assert.equal(g.plan?.state, "ready");
    assert.equal(g.inputTokens, 150);
    assert.equal(g.outputTokens, 300);
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("disabled generation does not make API calls and cancels reserved work", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await configureGeneration(f.env, f.id, {
      enabled: 0,
      daily_limit: 20,
      verification_model: "verify-model",
    });
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(mock.calls.length, 0);
    assert.equal((await generationStatus(f.env, f.id)).plan, null);
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("unapproved generated questions stay private and unseen questions cannot be reported", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    const result = await nextLiveQuestion(f.env, f.id);
    if (!result || "waiting" in result) throw Error("not ready");
    const other = f.user("other-user");
    const s = (await load(f.env, other)).state;
    const { questionsFor } = await import("../worker/engine");
    assert.equal(
      questionsFor(s).some((q) => q.id === result.questionId),
      false,
    );
    await assert.rejects(
      reportGenerated(f.env, other, result.questionId, "test"),
      /実際に出題された/,
    );
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("reported generated question loses rating observations but keeps earned XP", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    const result = await nextLiveQuestion(f.env, f.id);
    if (!result || "waiting" in result) throw Error("not ready");
    const correct = JSON.parse(
      f.sqlite
        .prepare("SELECT data FROM question_catalog WHERE id=?")
        .get(result.questionId)!.data as string,
    ).correct;
    await mutate(f.env, f.id, (s) => answer(s, result.id, correct));
    const before = (await load(f.env, f.id)).state;
    await reportGenerated(f.env, f.id, result.questionId, "解説に疑問");
    const after = (await load(f.env, f.id)).state;
    assert.equal(after.xp, before.xp);
    assert.equal(after.instance, null);
    assert.equal(after.answers[0].excluded, true);
    const { overview } = await import("../worker/engine");
    assert.equal(overview(after).bySubject[0].observations, 0);
    assert.equal(
      f.sqlite
        .prepare("SELECT suspended FROM question_catalog WHERE id=?")
        .get(result.questionId)!.suspended,
      0,
    );
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("an interrupted job becomes visible as failed without new billed attempts", async () => {
  const f = await setup();
  // Pinned to 12:00 JST so the +6min jump can never cross the JST day boundary.
  const now = Date.UTC(2026, 10, 12, 3, 0, 0);
  await ensurePlan(f.env, f.id, crypto.randomUUID(), now);
  const status = await generationStatus(f.env, f.id, now + 6 * 60000);
  assert.equal(status.plan!.state, "failed");
  assert.equal(status.used, 1);
  assert.equal(f.sent.length, 1);
  f.sqlite.close();
});
test("an interrupted job near midnight still fails visibly, with usage counted on the day it ran", async () => {
  const f = await setup();
  // 23:57 JST: the +6min status check lands on the next JST day.
  const now = Date.UTC(2026, 10, 12, 14, 57, 0);
  await ensurePlan(f.env, f.id, crypto.randomUUID(), now);
  const status = await generationStatus(f.env, f.id, now + 6 * 60000);
  assert.equal(status.plan!.state, "failed");
  // The billed attempt belongs to the previous JST day, so the new day starts at 0.
  assert.equal(status.used, 0);
  assert.equal(f.sent.length, 1);
  f.sqlite.close();
});
test("prefetch never selects the question currently being solved as an unseen new question", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    const first = await nextLiveQuestion(f.env, f.id);
    if (!first || "waiting" in first) throw Error("not ready");
    await ensurePlan(f.env, f.id, crypto.randomUUID());
    const status = await generationStatus(f.env, f.id);
    assert.equal(status.plan!.state, "pending");
    assert.equal(f.sent.length, 2);
    assert.equal(mock.calls.length, 2);
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("network failure records unknown usage and cannot trigger a silent retry", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("secret-key-must-not-leak");
  };
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    await runGeneration(f.env, f.sent[0].jobId);
    const status = await generationStatus(f.env, f.id);
    assert.equal(calls, 1);
    assert.equal(status.usageIncomplete, true);
    assert.equal(
      JSON.stringify(status).includes("secret-key-must-not-leak"),
      false,
    );
    assert.equal(status.plan!.state, "failed");
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
test("Anthropic-compatible generation uses messages and x-api-key with separate verification", async () => {
  const f = await setup();
  f.sqlite
    .prepare("UPDATE provider_configs SET format=?,base_url=? WHERE user_id=?")
    .run("anthropic", "https://anthropic.example.com/v1", f.id);
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const original = globalThis.fetch,
    calls: any[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://anthropic.example.com/v1/messages");
    const headers = new Headers(init!.headers);
    assert.equal(headers.get("x-api-key"), "generation-test-key");
    assert.equal(headers.has("Authorization"), false);
    const body = JSON.parse(init!.body as string);
    calls.push(body);
    const p = f.sqlite
      .prepare("SELECT * FROM generation_plans WHERE state='pending'")
      .get() as any;
    const q = {
      ...bank.find((q) => q.subject === "math1")!,
      stem: "Anthropic互換のテスト専用問題です。",
      subject: p.subject,
      topic: p.topic,
      difficulty: p.difficulty,
    };
    return Response.json({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            body.model === "generate-model"
              ? q
              : {
                  valid: true,
                  correct: q.correct,
                  reason: "テスト",
                  explanation: "互換APIの独立検証で作られた解説です。",
                  hint: "必要な定義を整理しよう。",
                },
          ),
        },
      ],
      usage: { input_tokens: 70, output_tokens: 80 },
    });
  };
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(calls.length, 2);
    const status = await generationStatus(f.env, f.id);
    assert.equal(status.plan!.state, "ready");
    assert.equal(status.inputTokens, 140);
    assert.equal(status.outputTokens, 160);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("official OpenAI generation uses the completion limit accepted by reasoning models", async () => {
  const f = await setup();
  f.sqlite
    .prepare("UPDATE provider_configs SET base_url=? WHERE user_id=?")
    .run("https://api.openai.com/v1", f.id);
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[0].body.max_completion_tokens, 2000);
    assert.equal(mock.calls[1].body.max_completion_tokens, 1800);
    assert.equal("max_tokens" in mock.calls[0].body, false);
    assert.equal((await generationStatus(f.env, f.id)).plan!.state, "ready");
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});

test("a scope change during generation stops verification and releases the active plan", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const original = globalThis.fetch,
    mock = fake(f),
    generate = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const response = await generate(url, init);
    await mutate(f.env, f.id, (s) => {
      s.subjects = ["english"];
    });
    return response;
  };
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(mock.calls.length, 1);
    const status = await generationStatus(f.env, f.id);
    assert.equal(status.plan, null);
    assert.equal(status.inputTokens, 50);
    assert.equal(status.outputTokens, 100);
    assert.equal(
      f.sqlite
        .prepare("SELECT state FROM generation_jobs WHERE id=?")
        .get(f.sent[0].jobId)!.state,
      "cancelled",
    );
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM question_catalog WHERE owner_user_id=?",
        )
        .get(f.id)!.n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("a provider redirect is rejected without forwarding the BYOK key or running verification", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init!.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { Location: "https://another.example.com/collect" },
    });
  };
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    assert.equal(calls, 1);
    const status = await generationStatus(f.env, f.id);
    assert.equal(status.plan!.state, "failed");
    assert.match(status.plan!.error!, /302/);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("operator-approved questions can be shared, while a report only excludes the reporter", async () => {
  const f = await setup();
  await ensurePlan(f.env, f.id, crypto.randomUUID());
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    const first = await nextLiveQuestion(f.env, f.id);
    if (!first || "waiting" in first) throw Error("not ready");
    f.sqlite
      .prepare(
        "UPDATE question_catalog SET sharing_status='approved',owner_user_id=NULL WHERE id=?",
      )
      .run(first.questionId);
    const other = f.user("shared-reader");
    await mutate(f.env, other, (s) => {
      s.subjects = ["math1"];
    });
    // Same topic for this learner; no new paid job or provider configuration is needed in bank mode.
    f.sqlite
      .prepare(
        "UPDATE question_catalog SET suspended=1 WHERE json_extract(data,'$.generation.status') IS NULL",
      )
      .run();
    const shared = await nextLiveQuestion(f.env, other);
    if (!shared || "waiting" in shared) throw Error("not ready");
    assert.equal(shared.questionId, first.questionId);
    await mutate(f.env, f.id, (s) => answer(s, first.id, null));
    await mutate(f.env, other, (s) => answer(s, shared.id, null));
    const xp = (await load(f.env, other)).state.xp;
    await reportGenerated(f.env, other, shared.questionId, "正解が曖昧");
    await reportGenerated(f.env, other, shared.questionId, "duplicate");
    assert.notEqual((await load(f.env, f.id)).state.answers[0].excluded, true);
    assert.equal((await load(f.env, other)).state.answers[0].excluded, true);
    assert.equal((await load(f.env, other)).state.xp, xp);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM question_reports").get()!.n,
      1,
    );
    assert.equal(mock.calls.length, 2);
    assert.equal(f.sent.length, 1);
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});
test("LLM planning balances subjects and avoids repeating the current topic even with fixed randomness", async () => {
  const f = await setup();
  await mutate(f.env, f.id, (s) => {
    s.subjects = ["math1", "english"];
  });
  await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
  const mock = fake(f);
  try {
    await runGeneration(f.env, f.sent[0].jobId);
    const first = await nextLiveQuestion(f.env, f.id);
    if (!first || "waiting" in first) throw Error("not ready");
    assert.equal(first.question.subject, "math1");
    await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
    const p = (await generationStatus(f.env, f.id)).plan!;
    assert.equal(p.subject, "english");
    await configureGeneration(f.env, f.id, {
      enabled: 1,
      daily_limit: 20,
      verification_model: "verify-model",
    });
    await mutate(f.env, f.id, (s) => {
      s.subjects = ["math1"];
    });
    await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
    const next = (await generationStatus(f.env, f.id)).plan!;
    assert.notEqual(next.topic, first.question.topic);
  } finally {
    mock.restore();
    f.sqlite.close();
  }
});

test("more than 100 daily attempts and an old saved cap do not block generation", async () => {
  const f = await setup(1),
    now = Date.now();
  // A stale client or old account may still carry a legacy limit. It is ignored.
  f.sqlite
    .prepare("UPDATE generation_settings SET daily_limit=1 WHERE user_id=?")
    .run(f.id);
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  for (let n = 0; n < 150; n++) {
    const jobId = crypto.randomUUID();
    f.sqlite
      .prepare(
        "INSERT INTO generation_plans(id,user_id,request_id,subject,basic_ranges,topic,difficulty,state,source,created_at) VALUES(?,?,?,'math1','[]','数と式',1,'used','generated',?)",
      )
      .run(jobId, f.id, crypto.randomUUID(), now);
    f.sqlite
      .prepare(
        "INSERT INTO generation_jobs(id,user_id,day,state,created_at,generation_model,verification_model) VALUES(?,?,?,'complete',?,'test','test')",
      )
      .run(jobId, f.id, today, now);
  }
  const status = await ensurePlan(f.env, f.id, crypto.randomUUID(), now);
  assert.equal(status.used, 151);
  assert.equal(status.dailyLimit, null);
  assert.equal(status.unlimited, true);
  assert.equal(status.plan!.state, "pending");
  assert.equal(f.sent.length, 1);
  await ensurePlan(f.env, f.id, crypto.randomUUID(), now);
  assert.equal(f.sent.length, 1); // Unlimited count does not permit duplicate concurrent jobs.
  f.sqlite.close();
});

test("numeric twins are rewritten once and private foreign questions never enter the generation prompt", async () => {
  const f = await setup(),
    original = globalThis.fetch;
  await ensurePlan(f.env, f.id, crypto.randomUUID(), Date.now(), () => 0);
  const p = f.sqlite.prepare("SELECT * FROM generation_plans").get() as any;
  const foreign = f.user("foreign-user"),
    oldStem = "長方形の縦が2 cm、横が3 cmのとき、面積はどれか。",
    foreignStem = "PRIVATE_FOREIGN_QUESTION_MATERIAL";
  const options = [
    { id: "a", text: "候補甲" },
    { id: "b", text: "候補乙" },
    { id: "c", text: "候補丙" },
    { id: "d", text: "候補丁" },
  ];
  const base = {
    ...bank[0],
    subject: p.subject,
    topic: p.topic,
    difficulty: p.difficulty,
    options,
    correct: "b",
  };
  for (const [id, owner, stem] of [
    ["old-numeric", f.id, oldStem],
    ["foreign-question", foreign, foreignStem],
  ])
    f.sqlite
      .prepare(
        "INSERT INTO question_catalog(id,subject,topic,version,data,owner_user_id,sharing_status) VALUES(?,?,?,1,?,?,'pending')",
      )
      .run(
        id,
        p.subject,
        p.topic,
        JSON.stringify({ ...base, id, stem }),
        owner,
      );
  const otherUnitStem =
    "本人の別単元の参照資料。二つのデータの分散を比較して説明する設問。";
  const otherTopic = p.topic === "データの分析" ? "数と式" : "データの分析";
  f.sqlite
    .prepare(
      "INSERT INTO question_catalog(id,subject,topic,version,data,owner_user_id,sharing_status) VALUES(?,?,?,1,?,?,'pending')",
    )
    .run(
      "own-other-unit",
      p.subject,
      otherTopic,
      JSON.stringify({
        ...base,
        id: "own-other-unit",
        topic: otherTopic,
        stem: otherUnitStem,
      }),
      f.id,
    );
  let writers = 0,
    checks = 0;
  globalThis.fetch = async (_url, init) => {
    const b = JSON.parse(init!.body as string);
    assert.equal(JSON.stringify(b).includes(foreignStem), false);
    assert.equal(JSON.stringify(b).includes(otherUnitStem), true);
    if (b.model === "verify-model") {
      checks++;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                correct: "b",
                valid: true,
                reason: "独立した検証",
                explanation: "問題の条件から比較して判断する手順を説明します。",
                hint: "与えられた条件を整理するところから始めます。",
              }),
            },
          },
        ],
      });
    }
    writers++;
    if (writers === 1) {
      assert.ok(b.messages.at(-1).content.includes(p.focus));
      assert.ok(b.messages.at(-1).content.includes(p.approach));
    }
    const stem =
      writers === 1
        ? "長方形の縦が4 cm、横が6 cmのとき、面積はどれか。"
        : "必要条件と十分条件の関係について、命題の対偶から判断するものはどれか。";
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ ...base, stem }) } }],
    });
  };
  try {
    await runGeneration(f.env, p.id);
    assert.equal(writers, 2);
    assert.equal(checks, 1);
    assert.equal((await generationStatus(f.env, f.id)).buffer.ready, 1);
    const q = await nextLiveQuestion(f.env, f.id);
    assert.ok(q && !("waiting" in q));
    assert.equal(JSON.stringify(q).includes(p.focus), false);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
