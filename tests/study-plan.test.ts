import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, overview, type Answer } from "../worker/engine";
import {
  studyReport,
  selectTarget,
  unitKey,
  curriculumFor,
  withinStudyScope,
} from "../worker/study-plan";
import { foundationLesson } from "../worker/study-lessons";
import { bank } from "../worker/bank";
import { schedule } from "../worker/engine";
import { mathOptions } from "../shared/study";

const now = Date.UTC(2026, 9, 17),
  day = 86400000;
function event(n: number, patch: Partial<Answer> = {}): Answer {
  return {
    id: "a" + n,
    instanceId: crypto.randomUUID(),
    questionId: "q" + n,
    subject: "math1",
    topic: "数と式",
    at: now - 3 * day + n * day,
    correct: true,
    option: "a",
    hint: false,
    forgot: false,
    first: true,
    dueReview: false,
    xp: 10,
    learning: 10,
    difficulty: 1,
    previousCard: null,
    drop: false,
    practiceKind: "practice",
    ...patch,
  };
}
test("novices start with a connected foundation and see only their chosen mathematics options", () => {
  const s = initialState();
  s.subjects = ["math1", "math2"];
  const report = studyReport(s, [], now),
    target = selectTarget(report, [], [], undefined, () => 0);
  assert.equal(target!.topic, "数と式");
  assert.equal(target!.difficulty, 1);
  assert.equal(target!.kind, "foundation");
  assert.equal(
    report.units.some((u) => u.topic === "平面上の曲線と複素数平面"),
    false,
  );
  s.studyGoal.mathOptions = [...mathOptions.slice(1)];
  assert.equal(
    curriculumFor(s).some((u) => u.topic === "数列"),
    false,
  );
  assert.equal(
    withinStudyScope(s, { subject: "math2", topic: "複素数平面" }),
    true,
  );
  assert.equal(withinStudyScope(s, { subject: "math2", topic: "数列" }), false);
});
test("assisted answers, forgotten guesses and repeated recognition cannot establish mastery", () => {
  const s = initialState();
  s.subjects = ["math1"];
  s.answers = Array.from({ length: 12 }, (_, n) =>
    event(n, {
      at: now - n * day,
      hint: n % 2 === 0,
      forgot: n % 2 !== 0,
      practiceKind: "transfer",
    }),
  ).reverse();
  let u = studyReport(s, [], now).units.find((u) => u.topic === "数と式")!;
  assert.equal(u.correct, 0);
  assert.equal(u.stage, "practice");
  s.answers = Array.from({ length: 12 }, (_, n) =>
    event(n, { questionId: "same", first: false, at: now - n * day }),
  ).reverse();
  u = studyReport(s, [], now).units.find((u) => u.topic === "数と式")!;
  assert.equal(u.independent, 0);
  assert.notEqual(u.stage, "secure");
});
test("secure requires distinct new problems, a delayed retrieval and transfer; overdue becomes due again", () => {
  const s = initialState();
  s.subjects = ["math1"];
  s.answers = [
    event(0),
    event(1),
    event(2, { practiceKind: "transfer" }),
    event(3, { practiceKind: "transfer" }),
    event(4, {
      at: now + 1000,
      first: false,
      dueReview: true,
      previousCard: {
        ...schedule(null, now - day, false),
        last_review: new Date(now - day),
      },
    }),
  ];
  const unit = () =>
    studyReport(
      s,
      [{ ...bank[0], id: "q4", subject: "math1", topic: "数と式" }],
      now + 1001,
    ).units.find((u) => u.topic === "数と式")!;
  assert.equal(unit().stage, "secure");
  s.cards.q4 = { ...schedule(null, now - day, false), due: new Date(now - 1) };
  assert.notEqual(unit().stage, "secure");
  assert.equal(unit().due, 1);
});
test("evidence maps legacy topic names by subject and invalid questions are excluded", () => {
  const s = initialState();
  s.subjects = ["english", "japanese"];
  const qs = [
    { ...bank[0], id: "en", subject: "english", topic: "語彙" },
    {
      ...bank[0],
      id: "ja",
      subject: "japanese",
      topic: "語彙",
      suspended: true,
    },
  ];
  s.answers = [
    event(0, { questionId: "en", subject: "english", topic: undefined }),
    event(1, { questionId: "ja", subject: "japanese", topic: undefined }),
  ];
  const report = studyReport(s, qs, now);
  assert.equal(
    report.units.find((u) => u.key === unitKey("english", "語彙"))!.correct,
    1,
  );
  assert.equal(
    report.bySubject.find((s) => s.subject === "japanese")!.observations,
    0,
  );
});
test("planned questions spread topics and weighted allocation still explores all subjects", () => {
  const s = initialState();
  s.subjects = ["english", "math1"];
  s.studyGoal.weights = { english: 200, math1: 100 };
  const report = studyReport(s, [], now),
    planned: { subject: string; topic: string }[] = [];
  for (let n = 0; n < 18; n++) {
    const t = selectTarget(report, [], planned, undefined, () => 0.5)!;
    planned.push(t);
  }
  const english = planned.filter((x) => x.subject === "english").length;
  assert.ok(english > 6 && english < 16);
  assert.ok(
    new Set(planned.slice(0, 5).map((u) => unitKey(u.subject, u.topic))).size >=
      4,
  );
});
test("five upcoming mathematics questions use distinct units and a single eligible unit never starves", () => {
  const s = initialState();
  s.subjects = ["math1"];
  const report = studyReport(s, [], now),
    planned: { subject: string; topic: string }[] = [];
  for (let n = 0; n < 21; n++) {
    const target = selectTarget(report, [], planned, undefined, () => 0)!;
    assert.ok(!planned.slice(-4).some((p) => p.topic === target.topic));
    planned.push(target);
  }
  assert.equal(new Set(planned.slice(0, 5).map((p) => p.topic)).size, 5);
  const only = [{ subject: "math1", topic: "数と式" }];
  assert.equal(selectTarget(report, [], only, only, () => 0)!.topic, "数と式");
});
test("goals use real recorded scores and current weights, never manufacture a predicted exam mark", () => {
  const s = initialState();
  s.subjects = ["english", "math1"];
  s.studyGoal.weights = { english: 200, math1: 100 };
  s.examRecords = [
    {
      id: crypto.randomUUID(),
      date: "2026-10-16",
      label: "過去問",
      timed: true,
      scores: [
        { subject: "english", score: 80, maxScore: 100 },
        { subject: "math1", score: 40, maxScore: 100 },
      ],
    },
  ];
  const r = studyReport(s, [], now);
  assert.equal(r.records[0].percent, 66.7);
  assert.equal(r.records[0].complete, true);
  assert.equal(r.daysLeft, 91);
  assert.equal("predictedPercent" in r, false);
  const o = overview(s, now);
  assert.equal(o.study.records[0].percent, 66.7);
});
test("operator foundation materials include concrete knowledge and a worked example with intact mathematics", () => {
  const lesson = foundationLesson({
    subject: "math1",
    topic: "二次関数",
    stem: "二次関数の最小値を求める",
  });
  assert.match(lesson.knowledge, /平方|二乗/);
  assert.ok(lesson.example?.steps.length);
  assert.match(lesson.example!.problem, /x/);
  const trig = foundationLesson({
    subject: "math1",
    topic: "図形と計量",
    stem: "sinとcosの三角比",
  });
  assert.ok(trig.example);
  assert.match(JSON.stringify(trig), /\\sin/);
});
