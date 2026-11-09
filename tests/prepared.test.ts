import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./d1-fixture";
import { load, mutate, nextQuestion } from "../worker/repository";
import { promotePrepared } from "../worker/prepared";
import { answer } from "../worker/engine";
import { bank } from "../worker/bank";
import { pickBalanced } from "../worker/variety";

test("preparing is safe, reusable, and does not advance or start the next answer clock", async () => {
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1", "english"];
  });
  const current = (await nextQuestion(f.env, id))!;
  const prepared = (await nextQuestion(
    f.env,
    id,
    false,
    Date.now() - 60000,
    () => 0,
    true,
  ))!;
  assert.notEqual(current.id, prepared.id);
  assert.notEqual(current.question.subject, prepared.question.subject);
  assert.equal(prepared.answered, null);
  for (const field of ["correct", "explanation", "hints"])
    assert.equal(field in prepared.question, false);
  assert.equal((await load(f.env, id)).state.instance!.id, current.id);
  assert.equal(
    (await nextQuestion(f.env, id, false, Date.now(), Math.random, true))!.id,
    prepared.id,
  );
  await assert.rejects(
    promotePrepared(f.env, id, prepared.id, current.id),
    /回答してください/,
  );
  await mutate(f.env, id, (s) =>
    answer(
      s,
      current.id,
      bank.find((q) => q.id === current.questionId)!.correct,
    ),
  );
  const before = Date.now();
  const next = (await promotePrepared(f.env, id, prepared.id, current.id))!;
  assert.equal(next.id, prepared.id);
  assert.ok(next.started >= before);
  assert.deepEqual(next.question.options, prepared.question.options);
  assert.equal(
    (await promotePrepared(f.env, id, prepared.id, current.id))!.id,
    next.id,
  );
  assert.equal((await load(f.env, id)).state.answers.length, 1);
  f.sqlite.close();
});
test("subject changes and quarantine invalidate a prepared question", async () => {
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  const current = (await nextQuestion(f.env, id))!;
  const prepared = (await nextQuestion(
    f.env,
    id,
    false,
    Date.now(),
    Math.random,
    true,
  ))!;
  await mutate(f.env, id, (s) => {
    answer(s, current.id, null);
    s.subjects = ["english"];
  });
  await assert.rejects(
    promotePrepared(f.env, id, prepared.id, current.id),
    /準備し直し/,
  );
  const english = (await nextQuestion(
    f.env,
    id,
    false,
    Date.now(),
    Math.random,
    true,
  ))!;
  f.sqlite
    .prepare("UPDATE question_catalog SET suspended=1 WHERE id=?")
    .run(english.questionId);
  await assert.rejects(
    promotePrepared(f.env, id, english.id, current.id),
    /準備し直し/,
  );
  f.sqlite.close();
});
test("balanced selection mixes ties randomly and chooses less-seen subjects", () => {
  assert.equal(
    pickBalanced(["math1", "english"], { math1: 4, english: 3 }, () => 0),
    "english",
  );
  assert.equal(
    pickBalanced(["math1", "english"], {}, () => 0.9),
    "english",
  );
});

test("a legacy prepared repeat cannot be promoted and is replaced by an unseen question", async () => {
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  const current = (await nextQuestion(f.env, id))!;
  const prepared = (await nextQuestion(
    f.env,
    id,
    false,
    Date.now(),
    Math.random,
    true,
  ))!;
  await mutate(f.env, id, (s) => answer(s, current.id, null));
  f.sqlite
    .prepare("UPDATE prepared_instances SET question_id=? WHERE user_id=?")
    .run(current.questionId, id);
  await assert.rejects(
    promotePrepared(f.env, id, prepared.id, current.id),
    /準備し直し/,
  );
  const replacement = (await nextQuestion(
    f.env,
    id,
    false,
    Date.now(),
    Math.random,
    true,
  ))!;
  assert.notEqual(replacement.questionId, current.questionId);
  f.sqlite.close();
});
