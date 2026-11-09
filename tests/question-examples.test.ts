import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { questionSchema } from "../scripts/question-schema";
import { subjects } from "../worker/catalog";
import { topics } from "../worker/curriculum";
import {
  questionExamples,
  selectQuestionExamples,
  generationExamples,
} from "../worker/question-examples";

test("editorial examples have valid four-choice content and renderable math", () => {
  assert.equal(
    new Set(questionExamples.map((q) => q.key)).size,
    questionExamples.length,
  );
  const stems = new Set<string>();
  for (const { key, question: q } of questionExamples) {
    questionSchema.parse({
      ...q,
      id: key,
      family: key,
      version: 1,
      source: "運営オリジナル品質見本",
    });
    assert.ok(topics[q.subject].includes(q.topic));
    assert.equal(stems.has(q.stem), false);
    stems.add(q.stem);
    for (const text of [
      q.stem,
      q.explanation,
      ...q.hints,
      ...q.options.map((o) => o.text),
    ])
      for (const [, math] of text.matchAll(/\$([^$]+)\$/g))
        assert.doesNotThrow(() =>
          katex.renderToString(math, { throwOnError: true }),
        );
  }
});
test("ten-shot examples rotate by job without losing subject relevance or changing on replay", () => {
  const a = selectQuestionExamples("math1", undefined, "job-alpha");
  assert.deepEqual(selectQuestionExamples("math1", undefined, "job-alpha"), a);
  const sets = Array.from({ length: 24 }, (_, i) =>
    selectQuestionExamples("math1", undefined, "job-" + i),
  );
  assert.ok(new Set(sets.map((s) => s[0].key)).size >= 5);
  assert.ok(new Set(sets.map((s) => s.map((q) => q.key).join(","))).size >= 12);
  for (const set of sets) {
    assert.equal(set.length, 10);
    assert.equal(set[0].question.subject, "math1");
  }
});

test("every subject receives ten examples with its own scope first", () => {
  for (const { id } of subjects) {
    for (const range of id === "basicScience"
      ? ["biology", "chemistry", "physics", "earth"]
      : [undefined]) {
      const examples = selectQuestionExamples(id, range);
      assert.equal(examples.length, 10);
      assert.equal(new Set(examples.map((q) => q.key)).size, 10);
      assert.equal(examples[0].question.subject, id);
      assert.equal(examples[0].question.basicRange, range);
      const messages = generationExamples(id, range);
      assert.equal(messages.length, 10);
      assert.ok(JSON.stringify(messages).length < 24000);
      assert.equal(JSON.parse(messages[0].assistant).subject, id);
    }
  }
});
