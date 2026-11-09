import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { defaultHint, selectedHint, hintChoices } from "../worker/hints";
import { topics } from "../worker/curriculum";

test("quadratic hint teaches completing the square and the meaning of its symbols without solving the actual question", () => {
  const q = {
    subject: "math1",
    topic: "二次関数",
    stem: "関数 $y=x^2-4x+7$ の最小値は？",
  };
  const text = defaultHint(q);
  assert.ok(text.includes("平方完成"));
  assert.ok(text.includes("b^2"));
  assert.ok(text.includes("平方"));
  assert.ok(text.includes("最初の一歩"));
  assert.equal(text.includes("最小値は3"), false);
  assert.equal(text.includes("x-2"), false);
  assert.equal(text.includes("思い出"), false);
});
test("hints teach definitions and units instead of asking a learner to recall unknown knowledge", () => {
  const probability = defaultHint({
    subject: "math1",
    topic: "場合の数と確率",
    stem: "サイコロを投げたときの確率は？",
  });
  assert.ok(probability.includes("全体の場合の数"));
  const chemistry = defaultHint({
    subject: "chemistry",
    topic: "物質量",
    stem: "物質量を求めよ",
  });
  assert.ok(chemistry.includes("n=m/M"));
  assert.ok(chemistry.includes("g/mol"));
  const logarithm = defaultHint({
    subject: "math2",
    topic: "指数関数と対数関数",
    stem: "対数を求めよ",
  });
  assert.ok(logarithm.includes("何乗したか"));
});
test("all current curriculum topics have renderable formulas and instructional material", () => {
  for (const [subject, units] of Object.entries(topics))
    for (const topic of units) {
      const q = { subject, topic, stem: topic };
      const choices = hintChoices(q);
      assert.ok(choices.length > 0);
      for (const choice of choices) {
        assert.ok(choice.text.includes("知っておくこと"));
        assert.ok(choice.text.includes("最初の一歩"));
        assert.equal(choice.text.includes("思い出"), false);
        for (const match of choice.text.matchAll(/\$([^$]+)\$/g))
          katex.renderToString(match[1], { throwOnError: true });
        assert.equal(
          selectedHint(JSON.stringify({ hintId: choice.hintId }), q),
          choice.text,
        );
      }
    }
});

test("tailored hints require an exact problem anchor and reject extra fields or answer declarations", async () => {
  const { parseQuestionHint } = await import("../worker/question-hints");
  const q = { stem: "関数 $y=x^2-4x+7$ の最小値は？" };
  const h = {
    anchor: "最小値は",
    focus: "最小値はという問いなので、平方の部分に注目します。",
    knowledge: "平方は実数の範囲では負にならない性質があります。",
    start: "問題の式を一般形と比べ、各項の係数を整理するところから始めます。",
  };
  assert.deepEqual(parseQuestionHint(JSON.stringify(h), q), h);
  for (const bad of [
    { ...h, anchor: "最大値は" },
    { ...h, answer: "3" },
    { ...h, start: "答えは3です。" },
  ])
    assert.throws(() => parseQuestionHint(JSON.stringify(bad), q));
});
