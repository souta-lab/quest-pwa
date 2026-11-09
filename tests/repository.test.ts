import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, seedNewAnswers } from "./d1-fixture";
import { bank } from "../worker/bank";
import {
  answer,
  attachBank,
  initialState,
  next,
  forget,
  heartbeat,
  publicInstance,
} from "../worker/engine";
import { load, commit, mutate, cohortKey } from "../worker/repository";
const at = Date.UTC(2026, 9, 5);
test("legacy JSON migration preserves rewards, FSRS, answers and handwriting", async () => {
  const f = fixture(false),
    id = f.user();
  const s = initialState(bank);
  s.subjects = ["math1"];
  next(s, at, () => 0);
  s.instance!.note = "legacy strokes";
  answer(
    s,
    s.instance!.id,
    bank.find((q) => q.id === s.instance!.questionId)!.correct,
    at,
    () => 0,
  );
  f.sqlite
    .prepare("INSERT INTO learning_states VALUES(?,7,?)")
    .run(id, JSON.stringify(s));
  f.migrations();
  const migrated = await load(f.env, id);
  assert.equal(migrated.revision, 8);
  assert.deepEqual(
    JSON.parse(JSON.stringify(migrated.state)),
    JSON.parse(JSON.stringify(s)),
  );
  const profile = JSON.parse(
    (
      f.sqlite.prepare("SELECT data FROM learning_profiles").get() as {
        data: string;
      }
    ).data,
  );
  assert.equal(profile.answers, undefined);
  assert.equal(profile.cards, undefined);
  assert.equal(profile.instance, undefined);
  assert.equal(publicInstance(migrated.state)!.answered!.xp, s.answers[0].xp);
  f.sqlite.close();
});
test("losing CAS cannot duplicate answers, rewards, drops or FSRS updates", async () => {
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    attachBank(s, bank);
    next(s, at, () => 0);
  });
  const a = await load(f.env, id),
    b = await load(f.env, id);
  for (const snap of [a, b])
    answer(
      snap.state,
      snap.state.instance!.id,
      bank.find((q) => q.id === snap.state.instance!.questionId)!.correct,
      at,
      () => 0,
    );
  assert.equal(await commit(f.env, id, a), true);
  assert.equal(await commit(f.env, id, b), false);
  const saved = (await load(f.env, id)).state;
  assert.equal(saved.answers.length, 1);
  assert.equal(saved.inventory, 1);
  assert.equal(saved.xp, a.state.xp);
  const retry = await mutate(f.env, id, (s) =>
    answer(s, s.instance!.id, s.answers[0].option, at, () => 0),
  );
  assert.equal(retry.xp, saved.answers[0].xp);
  assert.equal((await load(f.env, id)).state.inventory, 1);
  f.sqlite.close();
});
test("a child write failure rolls back the profile and all answer effects", async () => {
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    attachBank(s, bank);
    next(s, at, () => 0);
  });
  const before = await load(f.env, id);
  f.sqlite.exec(
    "CREATE TRIGGER fail_card BEFORE INSERT ON review_cards BEGIN SELECT RAISE(ABORT,'test failure'); END;",
  );
  answer(before.state, before.state.instance!.id, null, at, () => 0);
  await assert.rejects(commit(f.env, id, before), /test failure/);
  const after = await load(f.env, id);
  assert.equal(after.revision, before.revision);
  assert.equal(after.state.answers.length, 0);
  assert.equal(after.state.inventory, 0);
  assert.equal(after.state.xp, 0);
  f.sqlite.close();
});
test("heartbeat and note writes do not read or rewrite answer/card tables", async () => {
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    attachBank(s, bank);
    next(s, at, () => 0);
    answer(s, s.instance!.id, null, at, () => 0);
  });
  f.queries.length = 0;
  await mutate(
    f.env,
    id,
    (s) => {
      s.instance!.note = "new handwriting";
      heartbeat(s, "lease", false, at);
    },
    false,
  );
  assert.equal(
    f.queries.some((sql) =>
      /answer_events|review_cards|question_catalog/.test(sql),
    ),
    false,
  );
  const saved = (await load(f.env, id)).state;
  assert.equal(saved.answers.length, 1);
  assert.equal(saved.instance!.note, "new handwriting");
  assert.equal(Object.keys(saved.cards).length, 1);
  f.sqlite.close();
});
test("forgot corrections update a single answer and the corresponding card", async () => {
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    attachBank(s, bank);
    next(s, at, () => 0);
    answer(
      s,
      s.instance!.id,
      bank.find((q) => q.id === s.instance!.questionId)!.correct,
      at,
      () => 1,
    );
  });
  const old = (await load(f.env, id)).state;
  f.queries.length = 0;
  await mutate(f.env, id, (s) => forget(s, s.instance!.id));
  assert.equal(
    f.queries.filter((q) => q.startsWith("INSERT INTO answer_events")).length,
    1,
  );
  const saved = (await load(f.env, id)).state;
  assert.equal(saved.xp, old.xp);
  assert.equal(saved.answers[0].forgot, true);
  f.sqlite.close();
});
test("ranking cohort includes the chosen basic-science ranges", () => {
  const a = initialState(),
    b = initialState();
  a.subjects = b.subjects = ["basicScience", "math1"];
  a.basicRanges = ["biology", "chemistry"];
  b.basicRanges = ["physics", "earth"];
  assert.notEqual(cohortKey(a), cohortKey(b));
  b.subjects = ["math1"];
  a.subjects = ["math1"];
  assert.equal(cohortKey(a), cohortKey(b));
});
test("database selection preserves a pending instance and returns only safe question data", async () => {
  const { nextQuestion } = await import("../worker/repository");
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["basicScience"];
    s.basicRanges = ["physics", "earth"];
  });
  const a = await nextQuestion(f.env, id),
    b = await nextQuestion(f.env, id, true);
  assert.equal(a!.id, b!.id);
  assert.ok(!("correct" in a!.question));
  assert.ok(["physics", "earth"].includes(a!.question.basicRange!));
  assert.equal(a!.question.options.length, 4);
  f.sqlite.close();
});
test("10,000-question fixture selects in D1 without loading the whole bank or history", async () => {
  const { nextQuestion } = await import("../worker/repository");
  const f = fixture(),
    id = f.user();
  const insert = f.sqlite.prepare(
    "INSERT INTO question_catalog(id,subject,topic,basic_range,version,data) VALUES(?,?,?,?,?,?)",
  );
  f.sqlite.exec("BEGIN");
  for (let n = 0; n < 10000; n++) {
    const q = {
      ...bank.find((q) => q.subject === "math1")!,
      id: "load-fixture-" + n,
    };
    insert.run(q.id, q.subject, q.topic, null, 1, JSON.stringify(q));
  }
  f.sqlite.exec("COMMIT");
  await mutate(
    f.env,
    id,
    (s) => {
      s.subjects = ["math1"];
    },
    false,
  );
  f.queries.length = 0;
  const selected = await nextQuestion(f.env, id);
  assert.ok(selected);
  assert.equal(selected!.question.subject, "math1");
  assert.equal(
    f.queries.some(
      (q) => q === "SELECT data FROM question_catalog ORDER BY rowid",
    ),
    false,
  );
  assert.equal(
    f.queries.some(
      (q) =>
        q ===
        "SELECT instance_id,data FROM answer_events WHERE user_id=? ORDER BY answered_at,rowid",
    ),
    false,
  );
  const plan = f.sqlite
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM review_cards WHERE user_id=? AND due<=? ORDER BY due LIMIT 1",
    )
    .all(id, Date.now());
  assert.ok(plan.some((row) => String(row.detail).includes("review_due")));
  f.sqlite.close();
});
test("D1 selection chooses the oldest due card when review is selected", async () => {
  const { nextQuestion } = await import("../worker/repository");
  const { schedule } = await import("../worker/engine");
  const f = fixture(),
    id = f.user();
  const qs = bank.filter((q) => q.subject === "math1");
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    qs.forEach((q, n) => {
      s.cards[q.id] = {
        ...schedule(null, at, true),
        due: new Date(at + n * 1000),
      };
    });
  });
  seedNewAnswers(f, id, 9, at - 1200000);
  const result = await nextQuestion(f.env, id, false, at + 60000, () => 0);
  assert.equal(result!.questionId, qs[0].id);
  assert.equal(result!.dueReview, true);
  f.sqlite.close();
});
test("D1 selection picks the remaining unseen question before early extra practice", async () => {
  const { nextQuestion } = await import("../worker/repository");
  const { schedule } = await import("../worker/engine");
  const f = fixture(),
    id = f.user();
  const qs = bank.filter((q) => q.subject === "math1");
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    qs.slice(1).forEach((q) => {
      s.cards[q.id] = {
        ...schedule(null, at, true),
        due: new Date(at + 86400000),
      };
    });
  });
  const result = await nextQuestion(f.env, id, false, at, () => 0);
  assert.equal(result!.questionId, qs[0].id);
  assert.equal(result!.dueReview, false);
  f.sqlite.close();
});
test("question SQL preserves apostrophes, newlines and math backslashes", async () => {
  const { questionSQL } = await import("../scripts/question-sql");
  const f = fixture();
  const q = {
    ...bank[0],
    id: "sql-escaping-test",
    stem: "It's a test.\n$\\frac{1}{2}$",
  };
  f.sqlite.exec(questionSQL(q));
  const row = f.sqlite
    .prepare("SELECT data FROM question_catalog WHERE id=?")
    .get(q.id) as { data: string };
  assert.deepEqual(JSON.parse(row.data), JSON.parse(JSON.stringify(q)));
  f.sqlite.close();
});

test("recent due cards are held for ten minutes, then become eligible without changing FSRS", async () => {
  const { nextQuestion } = await import("../worker/repository");
  const f = fixture(),
    id = f.user(),
    now = Date.now();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  const first = (await nextQuestion(f.env, id, false, now, () => 0))!;
  await mutate(f.env, id, (s) => {
    answer(s, first.id, null, now, () => 1);
    s.instance = null;
  });
  f.sqlite
    .prepare("UPDATE question_catalog SET suspended=1 WHERE id<>?")
    .run(first.questionId);
  const due = f.sqlite
    .prepare("SELECT due FROM review_cards WHERE user_id=?")
    .get(id)!.due;
  await assert.rejects(
    nextQuestion(f.env, id, false, now + 120000, () => 0),
    /今出せる/,
  );
  seedNewAnswers(f, id, 8, now + 1);
  const review = (await nextQuestion(f.env, id, false, now + 600001, () => 0))!;
  assert.equal(review.questionId, first.questionId);
  assert.equal(review.dueReview, true);
  assert.equal(
    f.sqlite.prepare("SELECT due FROM review_cards WHERE user_id=?").get(id)!
      .due,
    due,
  );
  f.sqlite.close();
});
test("exhausted subjects cannot force early repeats while another subject has unseen questions", async () => {
  const { nextQuestion } = await import("../worker/repository");
  const { schedule } = await import("../worker/engine");
  const f = fixture(),
    id = f.user();
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1", "english"];
    for (const q of bank.filter((q) => q.subject === "math1"))
      s.cards[q.id] = {
        ...schedule(null, at, false),
        due: new Date(at + 86400000),
      };
  });
  assert.equal(
    (await nextQuestion(f.env, id, false, at, () => 0))!.question.subject,
    "english",
  );
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
    s.instance = null;
  });
  await assert.rejects(
    nextQuestion(f.env, id, false, at, () => 0),
    /今出せる/,
  );
  f.sqlite.close();
});
