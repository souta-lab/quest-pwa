import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGenerationDraft } from "../worker/generation-draft";
const scope = {
  subject: "physics",
  topic: "原子",
  difficulty: 2,
  basic_range: null,
};
const draft = {
  stem: "同じ条件で比較したとき、資料に合う説明はどれか。",
  options: ["説明甲", "説明乙", "説明丙", "説明丁"],
  correct: "C",
  difficulty: "2",
  expectedSeconds: "90",
};
test("writer formatting and unused explanations do not discard a valid question draft", () => {
  const q = parseGenerationDraft(
    { ...draft, explanation: "短", hints: [], basicRange: null },
    scope,
    "draft_1",
  );
  assert.equal(q.correct, "c");
  assert.equal(q.subject, "physics");
  assert.equal(q.expectedSeconds, 90);
  assert.equal(q.difficulty, 2);
  assert.equal(q.basicRange, undefined);
  assert.ok(q.explanation.includes("独立した解答チェック"));
});
test("draft normalization never guesses an ambiguous answer or accepts repeated choices", () => {
  for (const change of [
    { correct: 2 },
    { correct: "説明丙" },
    { options: ["甲", "甲", "乙", "丙"] },
    { options: ["甲", "乙", "丙"] },
    { expectedSeconds: "3分" },
  ])
    assert.throws(() =>
      parseGenerationDraft({ ...draft, ...change }, scope, "draft_2"),
    );
});
