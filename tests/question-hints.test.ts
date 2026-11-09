import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./d1-fixture";
import { seal } from "../worker/security";
import { bank } from "../worker/bank";
import {
  questionHint,
  parseQuestionHint,
  HintValidationError,
} from "../worker/question-hints";

const q = {
  ...bank.find((q) => q.subject === "math1")!,
  stem: "関数 $y=x^2-4x+7$ の最小値を求める。",
  explanation: "CHECKER_ONLY_SOLUTION_SENTINEL",
};
const draft = {
  anchor: "最小値を求める",
  focus: "「最小値を求める」という条件に着目し、平方の性質を使います。",
  knowledge:
    "実数の平方は0以上です。平方完成とは、二次式を平方の項と定数に分ける変形です。",
  start:
    "問題文の二次式を項ごとに分け、文字の次数と係数を確認するところから始めます。",
};
const approved = { safe: true, grounded: true, useful: true };
async function setup() {
  const f = fixture();
  const provider = {
    format: "openai",
    base_url: "https://hints.example.invalid/v1",
    model: "hint-model",
    ...(await seal("hint-test-key", f.env)),
  };
  return { ...f, provider };
}
const response = (value: unknown, fenced = false) =>
  Response.json({
    choices: [
      {
        message: {
          content:
            (fenced ? "```json\n" : "") +
            JSON.stringify(value) +
            (fenced ? "\n```" : ""),
        },
      },
    ],
  });

test("fenced hint and review JSON and paragraph spacing preserve exactly three stages", async () => {
  const f = await setup(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () =>
    response(
      calls++
        ? approved
        : {
            ...draft,
            knowledge: draft.knowledge + "\n\n各項を順に確認します。",
          },
      true,
    );
  try {
    const text = await questionHint(f.env, f.provider, q);
    assert.equal(calls, 2);
    assert.equal(text.split("\n\n").length, 4);
    assert.ok(text.includes("各項を順に確認します。"));
    assert.throws(() =>
      parseQuestionHint(
        "```json\n" + JSON.stringify(draft) + "\n```\n正解はA",
        q,
      ),
    );
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("rejected draft is rewritten once and independently approved without sending solutions back to the writer", async () => {
  const f = await setup(),
    original = globalThis.fetch;
  let writers = 0,
    checks = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init!.body as string),
      material = JSON.parse(body.messages[1].content);
    if (body.messages[0].content.includes("検査器")) {
      checks++;
      assert.equal(material.solutionForSafetyCheck.explanation, q.explanation);
      return response(
        checks === 1
          ? { ...approved, safe: false, reason: q.explanation }
          : approved,
      );
    }
    writers++;
    assert.equal(material.stem, q.stem);
    assert.equal(material.correct, undefined);
    assert.equal(material.solutionForSafetyCheck, undefined);
    assert.equal(JSON.stringify(body).includes(q.explanation), false);
    if (writers === 2)
      assert.ok(body.messages[0].content.includes("答えへ踏み込みすぎた"));
    return response({
      ...draft,
      start: draft.start + (writers === 2 ? "まずは整理だけを行います。" : ""),
    });
  };
  try {
    const text = await questionHint(f.env, f.provider, q);
    assert.equal(writers, 2);
    assert.equal(checks, 2);
    assert.ok(text.includes("まずは整理だけを行います。"));
    assert.equal(text.includes(q.explanation), false);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("malformed and ungrounded hints get one bounded rewrite followed by validation", async () => {
  for (const bad of [
    "not-json",
    JSON.stringify({ ...draft, anchor: "存在しない条件" }),
  ]) {
    const f = await setup(),
      original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1)
        return Response.json({ choices: [{ message: { content: bad } }] });
      return response(calls === 2 ? draft : approved);
    };
    try {
      assert.ok(
        (await questionHint(f.env, f.provider, q)).includes("この問題のヒント"),
      );
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = original;
      f.sqlite.close();
    }
  }
});

test("every independent check must approve; false and string booleans never reach the learner", async () => {
  for (const rejected of [
    { ...approved, safe: false },
    { ...approved, grounded: false },
    { ...approved, useful: false },
    { ...approved, safe: "true" },
  ]) {
    const f = await setup(),
      original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => response(++calls % 2 ? draft : rejected);
    try {
      await assert.rejects(
        questionHint(f.env, f.provider, q),
        HintValidationError,
      );
      assert.equal(calls, 4);
    } finally {
      globalThis.fetch = original;
      f.sqlite.close();
    }
  }
});

test("a direct answer or unknown output field never bypasses local validation", async () => {
  for (const bad of [
    { ...draft, start: "答えは3です。以上です。" },
    { ...draft, answer: "3" },
  ]) {
    const f = await setup(),
      original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return response(bad);
    };
    try {
      await assert.rejects(
        questionHint(f.env, f.provider, q),
        HintValidationError,
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
      f.sqlite.close();
    }
  }
});

test("network and provider failures stop without automatically repeating paid calls", async () => {
  const f = await setup(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("", { status: 429 });
  };
  try {
    await assert.rejects(questionHint(f.env, f.provider, q));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
