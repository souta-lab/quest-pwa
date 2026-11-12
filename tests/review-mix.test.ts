import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, seedNewAnswers } from "./d1-fixture";
import { bank } from "../worker/bank";
import { answer } from "../worker/engine";
import { load, mutate, nextQuestion } from "../worker/repository";
import { reviewSlot } from "../worker/review-mix";
import { getPrepared, promotePrepared } from "../worker/prepared";
import { getScheduler, schedule } from "../worker/cards";

const scheduler = await getScheduler();

test("a large due backlog alternates retrieval and new learning in 30 answers", async () => {
  const f = fixture(),
    id = f.user(),
    now = Date.now();
  const base = bank.find((q) => q.subject === "math1")!;
  const insert = f.sqlite.prepare(
    "INSERT INTO question_catalog(id,subject,topic,version,data) VALUES(?,?,?,1,?)",
  );
  for (let n = 0; n < 160; n++) {
    const q = { ...base, id: "mix-" + n };
    insert.run(q.id, q.subject, q.topic, JSON.stringify(q));
  }
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    for (let n = 0; n < 80; n++)
      s.cards["mix-" + n] = {
        ...schedule(scheduler, null, "mix-" + n, now - 86400000, true),
        dueAt: new Date(now - 86400000),
      };
  });
  let reviews = 0;
  for (let n = 0; n < 30; n++) {
    const q = (await nextQuestion(f.env, id, true, now + n * 600001, () => 0))!;
    assert.equal(q.dueReview, n % 2 === 0, "answer " + (n + 1));
    reviews += Number(q.dueReview);
    await mutate(f.env, id, (s) => {
      answer(
        s,
        scheduler,
        q.id,
        q.question.options[0].id,
        now + n * 600001,
        () => 1,
      );
    });
  }
  assert.equal(reviews, 15);
  assert.equal(
    (await load(f.env, id)).state.answers.filter((a) => a.first).length,
    15,
  );
  f.sqlite.close();
});

test("prefetch includes the current new problem in the two-new retrieval cadence without double counting", async () => {
  const f = fixture(),
    id = f.user(),
    now = Date.now();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  seedNewAnswers(f, id, 1, now - 1200000);
  const current = (await nextQuestion(f.env, id, false, now, () => 0))!;
  await mutate(f.env, id, (s) => {
    const other = bank.find(
      (q) => q.subject === "math1" && q.id !== current.questionId,
    )!;
    s.cards[other.id] = {
      ...schedule(scheduler, null, other.id, now - 86400000, true),
      dueAt: new Date(now - 86400000),
    };
  });
  assert.equal(await reviewSlot(f.env, id), false);
  const prepared = (await nextQuestion(f.env, id, false, now, () => 0, true))!;
  assert.equal(prepared.dueReview, true);
  const second = (await nextQuestion(f.env, id, false, now, () => 0, true))!;
  assert.equal(second.id, prepared.id);
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) n FROM answer_events").get()!.n,
    1,
  );
  await mutate(f.env, id, (s) => {
    answer(s, scheduler, current.id, null, now, () => 1);
  });
  const snapshot = await load(f.env, id, "current");
  assert.equal(await reviewSlot(f.env, id, snapshot.state.instance), true);
  await promotePrepared(f.env, id, prepared.id, current.id);
  await mutate(f.env, id, (s) => {
    answer(s, scheduler, prepared.id, null, now + 1, () => 1);
  });
  assert.equal(await reviewSlot(f.env, id), false);
  f.sqlite.close();
});

test("an exhausted new pool can use only genuinely due retrieval cards", async () => {
  const f = fixture(),
    id = f.user(),
    now = Date.now();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    for (const q of bank.filter((q) => q.subject === "math1"))
      s.cards[q.id] = {
        ...schedule(scheduler, null, q.id, now - 86400000, true),
        dueAt: new Date(now - 86400000),
      };
  });
  const q = (await nextQuestion(f.env, id, false, now, () => 0))!;
  assert.equal(q.dueReview, true);
  assert.ok(
    +new Date((await load(f.env, id)).state.cards[q.questionId].dueAt) <= now,
  );
  f.sqlite.close();
});

test("an old prepared review is discarded if its mix slot is no longer available", async () => {
  const f = fixture(),
    id = f.user(),
    now = Date.now();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  seedNewAnswers(f, id, 1, now - 1200000);
  const current = (await nextQuestion(f.env, id, false, now, () => 0))!;
  await mutate(f.env, id, (s) => {
    const other = bank.find(
      (q) => q.subject === "math1" && q.id !== current.questionId,
    )!;
    s.cards[other.id] = {
      ...schedule(scheduler, null, other.id, now - 86400000, true),
      dueAt: new Date(now - 86400000),
    };
  });
  assert.equal(
    (await nextQuestion(f.env, id, false, now, () => 0, true))!.dueReview,
    true,
  );
  f.sqlite
    .prepare(
      "UPDATE answer_events SET data=json_set(data,'$.first',json('false')) WHERE instance_id=(SELECT instance_id FROM answer_events ORDER BY answered_at DESC LIMIT 1)",
    )
    .run();
  assert.equal(
    await getPrepared(f.env, id, (await load(f.env, id, "current")).state),
    null,
  );
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) n FROM prepared_instances").get()!.n,
    0,
  );
  f.sqlite.close();
});
