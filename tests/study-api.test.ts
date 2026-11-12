import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index";
import { fixture } from "./d1-fixture";
import { hash } from "../worker/security";
import { mutate, nextQuestion, load, loadPlanning } from "../worker/repository";
import { overview } from "../worker/engine";
import { defaultStudyGoal, mathOptions } from "../shared/study";
import { bank } from "../worker/bank";
import { courseKey } from "../shared/course";
import { courseLessons } from "../worker/course-content";
import { getScheduler, schedule } from "../worker/cards";

const scheduler = await getScheduler();

async function setup() {
  const f = fixture(),
    id = f.user();
  f.sqlite
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(await hash("study-token"), id, Date.now() + 60000);
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1", "math2"];
  });
  const call = async (
    path: string,
    b: unknown,
    origin = "http://localhost:8787",
  ) =>
    worker.fetch(
      new Request("http://localhost:8787/api" + path, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: "quest_session=study-token",
        },
        body: JSON.stringify(b),
      }),
      f.env,
    );
  return { ...f, id, call };
}
test("quarantined foreign legacy cards do not inflate a learner's due backlog or mastery", async () => {
  const f = await setup();
  try {
    const other = f.user("other-owner"),
      q = {
        ...bank.find((q) => q.subject === "math1")!,
        id: "foreign-old",
        topic: "数と式",
      };
    f.sqlite
      .prepare(
        "INSERT INTO question_catalog(id,subject,topic,version,data,owner_user_id,sharing_status) VALUES(?,?,?,1,?,?,'pending')",
      )
      .run(q.id, q.subject, q.topic, JSON.stringify(q), other);
    await mutate(f.env, f.id, (s) => {
      s.cards[q.id] = {
        ...schedule(scheduler, null, q.id, Date.now() - 86400000, true),
        dueAt: new Date(0),
      };
    });
    f.sqlite
      .prepare(
        "INSERT INTO question_catalog(id,subject,topic,version,data,sharing_status) VALUES('orphan-pending','math1','数と式',1,?,'pending')",
      )
      .run(JSON.stringify({ ...q, id: "orphan-pending" }));
    await mutate(f.env, f.id, (s) => {
      s.cards["orphan-pending"] = {
        ...schedule(
          scheduler,
          null,
          "orphan-pending",
          Date.now() - 86400000,
          true,
        ),
        dueAt: new Date(0),
      };
    });
    for (const s of [
      (await load(f.env, f.id)).state,
      await loadPlanning(f.env, f.id),
    ])
      assert.equal(overview(s).study.due, 0);
  } finally {
    f.sqlite.close();
  }
});
test("study goals accept partial weights, reject invalid dates and require three distinct mathematics options", async () => {
  const f = await setup();
  try {
    const b = defaultStudyGoal();
    assert.equal((await f.call("/study-goal", b)).status, 200);
    for (const patch of [
      { examDate: "2027-02-30" },
      { weights: { unknown: 100 } },
      { weights: { math1: 0 } },
      { mathOptions: [mathOptions[0], mathOptions[0], mathOptions[1]] },
      { dailyMinutes: 0 },
    ])
      assert.equal(
        (await f.call("/study-goal", { ...b, ...patch })).status,
        400,
      );
    assert.equal(
      (await f.call("/study-goal", b, "https://attacker.invalid")).status,
      403,
    );
    assert.deepEqual((await load(f.env, f.id)).state.studyGoal, b);
  } finally {
    f.sqlite.close();
  }
});
test("changing mathematics selection invalidates excluded current and prepared questions without losing learning history", async () => {
  const f = await setup();
  try {
    const q = {
      ...bank.find((q) => q.subject === "math2")!,
      id: "curve",
      topic: "平面上の曲線と複素数平面",
    };
    f.sqlite
      .prepare(
        "INSERT INTO question_catalog(id,subject,topic,version,data) VALUES(?,?,?,1,?)",
      )
      .run(q.id, q.subject, q.topic, JSON.stringify(q));
    await mutate(f.env, f.id, (s) => {
      s.studyGoal.mathOptions = [...mathOptions.slice(1)];
      s.xp = 123;
      s.instance = {
        id: crypto.randomUUID(),
        questionId: q.id,
        optionIds: q.options.map((o) => o.id),
        started: Date.now(),
        hint: false,
        dueReview: false,
        boosted: false,
        note: "memo",
      };
    });
    const r = await f.call("/study-goal", defaultStudyGoal());
    assert.equal(r.status, 200);
    const data = (await r.json()) as any;
    assert.equal(data.instance, null);
    assert.equal(data.overview.xp, 123);
  } finally {
    f.sqlite.close();
  }
});
test("foundation delivery marks only its own unanswered instance assisted, with no solution in normal question response", async () => {
  const f = await setup();
  try {
    const q = (await nextQuestion(f.env, f.id))!;
    assert.equal("correct" in q.question, false);
    assert.equal("lesson" in q, false);
    assert.equal(
      (await f.call("/lesson", { instanceId: crypto.randomUUID() })).status,
      409,
    );
    assert.equal((await load(f.env, f.id)).state.instance!.hint, false);
    const r = await f.call("/lesson", { instanceId: q.id });
    assert.equal(r.status, 200);
    const data = (await r.json()) as any;
    assert.ok(data.lesson.knowledge);
    assert.ok(data.lesson.example.steps.length);
    assert.equal(data.instance.hint, true);
    assert.equal(
      (await load(f.env, f.id)).state.instance!.instructionSeen,
      true,
    );
  } finally {
    f.sqlite.close();
  }
});
test("learning course writes are owner scoped, validate the syllabus, persist independently of answers and do not award XP", async () => {
  const f = await setup();
  const selection = { subject: "math1", topic: "数と式", lesson: "等式の変形" };
  try {
    assert.equal(
      (
        await f.call("/course/route", {
          selection: { ...selection, subject: "biology" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("/course/check", {
          ...selection,
          input: "7",
          requestId: crypto.randomUUID(),
        })
      ).status,
      409,
    );
    const q = await nextQuestion(f.env, f.id);
    assert.ok(q);
    const route = await f.call("/course/route", { selection });
    assert.equal(route.status, 200);
    assert.equal(((await route.json()) as any).instance, null);
    const r = await f.call("/course/lesson", selection);
    assert.equal(r.status, 200);
    const data = (await r.json()) as any;
    assert.equal(data.overview.course.read, 1);
    assert.equal(data.overview.course.reproduced, 0);
    assert.equal("answers" in data.lesson, false);
    const requestId = crypto.randomUUID();
    for (let n = 0; n < 2; n++) {
      const r = await f.call("/course/check", {
        ...selection,
        input: "7",
        requestId,
      });
      assert.equal(r.status, 200);
      assert.equal(((await r.json()) as any).overview.course.reproduced, 1);
    }
    const s = (await load(f.env, f.id)).state;
    assert.equal(s.course.records[courseKey(selection)].attempts, 1);
    assert.equal(s.answers.length, 0);
    assert.equal(s.xp, 0);
    const other = f.user("course-other");
    assert.deepEqual((await load(f.env, other)).state.course.records, {});
    assert.equal(
      (
        await f.call(
          "/course/route",
          { selection: null },
          "https://attacker.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.call("/course/route", { selection: null })).status,
      200,
    );
    assert.equal(
      (await load(f.env, f.id)).state.course.records[courseKey(selection)]
        .attempts,
      1,
    );
    assert.ok(courseLessons(selection.subject, selection.topic).length);
  } finally {
    f.sqlite.close();
  }
});
test("pre-choice responses freeze before choices, survive reload, and cannot be retroactively changed after recognition or grading", async () => {
  const f = await setup();
  try {
    const i = (await nextQuestion(f.env, f.id))!;
    assert.equal(
      (
        await f.call("/recall", {
          instanceId: i.id,
          mode: "recall",
          input: "  ",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("/recall", {
          instanceId: crypto.randomUUID(),
          mode: "recall",
          input: "7",
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.call("/recall", { instanceId: i.id, mode: "recognition" }))
        .status,
      200,
    );
    assert.equal(
      (
        await f.call("/recall", {
          instanceId: i.id,
          mode: "recall",
          input: "now I saw it",
        })
      ).status,
      200,
    );
    let s = (await load(f.env, f.id)).state;
    assert.equal(s.instance!.responseMode, "recognition");
    assert.equal(s.instance!.recallDraft, "");
    await f.call("/answer", { instanceId: i.id, option: null });
    assert.equal(
      (
        await f.call("/recall", {
          instanceId: i.id,
          mode: "recall",
          input: "7",
        })
      ).status,
      409,
    );
    s = (await load(f.env, f.id)).state;
    assert.equal(s.answers[0].responseMode, "recognition");
    const next = (await nextQuestion(f.env, f.id, true))!;
    const r = await f.call("/recall", {
      instanceId: next.id,
      mode: "recall",
      input: "等式の両辺に同じ操作",
    });
    assert.equal(r.status, 200);
    await f.call("/answer", { instanceId: next.id, option: null });
    const a = (await load(f.env, f.id)).state.answers.at(-1)!;
    assert.equal(a.responseMode, "recall");
    assert.equal(a.recallText, "等式の両辺に同じ操作");
  } finally {
    f.sqlite.close();
  }
});
test("a guided bank session selects matching lessons, progresses to transfer and retracts proof when a correct answer was a guess", async () => {
  const f = await setup();
  const selection = { subject: "math1", topic: "数と式", lesson: "等式の変形" };
  try {
    for (const [n, focus] of [
      [0, selection.lesson],
      [1, selection.lesson],
      [2, "別の論点"],
    ] as const) {
      const q = {
        ...bank.find((q) => q.subject === "math1")!,
        id: `guided-${n}`,
        subject: "math1",
        topic: "数と式",
        difficulty: n + 1,
        generation: {
          status: "machine_checked",
          model: "test",
          verificationModel: "test",
          checkedAt: Date.now(),
          focus,
          teachingVersion: "course-1",
        },
      };
      f.sqlite
        .prepare(
          "INSERT INTO question_catalog(id,subject,topic,version,data,owner_user_id,sharing_status) VALUES(?,?,?,1,?,?,'pending')",
        )
        .run(q.id, q.subject, q.topic, JSON.stringify(q), f.id);
    }
    await f.call("/course/route", { selection });
    await f.call("/course/lesson", selection);
    await f.call("/course/check", {
      ...selection,
      input: "7",
      requestId: crypto.randomUUID(),
    });
    const first = (await nextQuestion(f.env, f.id))!;
    assert.equal(first.questionId, "guided-0");
    assert.equal(first.study!.kind, "practice");
    const prepared = (await nextQuestion(
      f.env,
      f.id,
      false,
      Date.now(),
      () => 0,
      true,
    ))!;
    assert.equal(prepared.questionId, "guided-1");
    assert.equal(prepared.study!.kind, "transfer");
    let second: typeof first | null = null;
    for (let n = 0; n < 2; n++) {
      const i = n ? (await nextQuestion(f.env, f.id, true))! : first;
      if (n) second = i;
      await f.call("/recall", {
        instanceId: i.id,
        mode: "recall",
        input: "条件から計算した値",
      });
      const r = await f.call("/answer", {
        instanceId: i.id,
        option: bank.find((q) => q.subject === "math1")!.correct,
      });
      assert.equal(r.status, 200);
      const data = (await r.json()) as any;
      assert.equal(data.overview.course.active.proof, n + 1);
      assert.equal(data.overview.course.applied, n);
      assert.equal(data.result.courseLesson, courseKey(selection));
    }
    const before = (await load(f.env, f.id)).state.xp;
    const r = await f.call("/forget", { instanceId: second!.id });
    const data = (await r.json()) as any;
    assert.equal(data.overview.course.applied, 0);
    assert.equal(data.overview.xp, before);
    assert.equal((await load(f.env, f.id)).state.answers.length, 2);
  } finally {
    f.sqlite.close();
  }
});
test("exam records are bounded, validated, owner scoped and idempotent", async () => {
  const f = await setup();
  try {
    const record = {
      id: crypto.randomUUID(),
      date: "2026-10-16",
      label: "過去問",
      timed: true,
      scores: [{ subject: "math1", score: 70, maxScore: 100 }],
    };
    assert.equal((await f.call("/exam-results", record)).status, 200);
    assert.equal((await f.call("/exam-results", record)).status, 200);
    assert.equal((await load(f.env, f.id)).state.examRecords.length, 1);
    for (const scores of [
      [{ subject: "math1", score: 101, maxScore: 100 }],
      [{ subject: "english", score: 50, maxScore: 100 }],
      [...record.scores, ...record.scores],
    ])
      assert.equal(
        (await f.call("/exam-results", { ...record, scores })).status,
        400,
      );
    assert.equal(
      (await f.call("/exam-results", { ...record, date: "2027-02-30" })).status,
      400,
    );
    assert.equal(
      (await f.call("/exam-results", { remove: record.id })).status,
      200,
    );
    assert.equal((await load(f.env, f.id)).state.examRecords.length, 0);
  } finally {
    f.sqlite.close();
  }
});
test("answer time is capped by server elapsed time and retries cannot inflate it; reflections alter learning advice only", async () => {
  const f = await setup();
  try {
    const q = (await nextQuestion(f.env, f.id))!;
    const r = await f.call("/answer", {
      instanceId: q.id,
      option: null,
      activeMs: 1000000,
    });
    assert.equal(r.status, 200);
    let s = (await load(f.env, f.id)).state;
    const xp = s.xp,
      time = s.answers[0].activeMs;
    assert.ok(time !== undefined && time < 10000);
    assert.equal(
      (
        await f.call("/answer", {
          instanceId: q.id,
          option: null,
          activeMs: 1800000,
        })
      ).status,
      200,
    );
    assert.equal((await load(f.env, f.id)).state.answers[0].activeMs, time);
    assert.equal(
      (await f.call("/reflection", { instanceId: q.id, kind: "reading" }))
        .status,
      200,
    );
    s = (await load(f.env, f.id)).state;
    assert.equal(s.answers[0].errorKind, "reading");
    assert.equal(s.xp, xp);
    assert.equal(
      (
        await f.call("/reflection", {
          instanceId: crypto.randomUUID(),
          kind: "reading",
        })
      ).status,
      400,
    );
  } finally {
    f.sqlite.close();
  }
});
