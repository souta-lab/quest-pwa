import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { topics } from "../worker/curriculum";
import { initialState, type Answer } from "../worker/engine";
import { courseLessons } from "../worker/course-content";
import { recallChecks, checkRecall } from "../worker/course-checks";
import {
  readCourse,
  attemptCourse,
  courseReport,
  courseForQuestion,
  touchCourseSupport,
} from "../worker/course";
import { courseKey } from "../shared/course";
import { studyReport, selectTarget } from "../worker/study-plan";
import { cohortKey, preparationKey } from "../worker/repository";
import { bank } from "../worker/bank";
const selection = { subject: "math1", topic: "数と式", lesson: "等式の変形" };
const key = courseKey(selection),
  at = Date.UTC(2026, 9, 19),
  DAY = 86400000;
function state() {
  const s = initialState();
  s.subjects = ["math1"];
  s.course.active = selection;
  return s;
}
function event(n: number, patch: Partial<Answer> = {}): Answer {
  return {
    id: `a${n}`,
    instanceId: `i${n}`,
    questionId: `q${n}`,
    subject: "math1",
    topic: "数と式",
    at: at + n,
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
    practiceKind: n ? "transfer" : "practice",
    responseMode: "recall",
    recallText: "7。両辺から5を引く",
    courseLesson: key,
    courseVersion: "course-1",
    ...patch,
  };
}
test("every curriculum chapter has concrete teaching, a worked example and a private short-answer check", () => {
  let units = 0,
    lessons = 0;
  for (const [subject, ts] of Object.entries(topics))
    for (const topic of ts) {
      units++;
      const ls = courseLessons(subject, topic);
      assert.ok(ls.length, `${subject}/${topic}`);
      for (const l of ls) {
        lessons++;
        assert.ok(l.knowledge.length >= 20, l.title);
        assert.ok(
          l.example?.steps.length && l.example.problem && l.example.conclusion,
          l.title,
        );
        const check = recallChecks[l.title];
        assert.ok(check?.answers.length, l.title);
        assert.equal(l.prompt, check.prompt);
        assert.equal("answers" in l, false);
        for (const a of check.answers)
          assert.equal(checkRecall(check, a), true, l.title);
        assert.equal(
          checkRecall(check, "ありえない回答000000"),
          false,
          l.title,
        );
        for (const text of [
          l.knowledge,
          l.method,
          l.prompt,
          l.example!.problem,
          ...l.example!.steps,
          l.example!.conclusion,
        ]) {
          for (const match of text.matchAll(/\$([^$]+)\$/g))
            katex.renderToString(match[1], {
              throwOnError: true,
              trust: false,
            });
          assert.equal(
            /[\u0000-\u0008\u000b\u000c]/.test(text),
            false,
            l.title,
          );
        }
      }
    }
  assert.equal(units, 87);
  assert.equal(lessons, 107);
  assert.equal(checkRecall(recallChecks["等式の変形"], " ｘ ＝ ７ "), true);
});
test("reading and recognition cannot masquerade as reproduced or applied knowledge", () => {
  const s = state();
  const lesson = readCourse(s, selection, at);
  assert.equal("answers" in lesson, false);
  let r = courseReport(s, [], at);
  assert.deepEqual(r.active!.steps, [true, false, false, false]);
  const id = crypto.randomUUID();
  assert.equal(attemptCourse(s, selection, "wrong", id, at + 1).correct, false);
  assert.equal(
    attemptCourse(s, selection, "7", id, at + 2).correct,
    false,
    "same request replays the first result",
  );
  assert.equal(s.course.records[key].attempts, 1);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 3);
  s.answers = [
    event(0, { responseMode: "recognition" }),
    event(1, { hint: true }),
    event(2, { forgot: true }),
    event(3, { responseMode: undefined }),
    event(4, { first: false }),
  ];
  r = courseReport(s, [], at + 4);
  assert.deepEqual(r.active!.steps, [true, true, false, false]);
  assert.equal(r.active!.proof, 0);
  assert.equal(s.xp, 0);
});
test("two distinct unassisted pre-choice answers including transfer and a genuinely delayed check establish the four milestones", () => {
  const s = state();
  readCourse(s, selection, at);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 1);
  s.answers = [event(0), event(1)];
  let r = courseReport(s, [], at + 1000);
  assert.deepEqual(r.active!.steps, [true, true, true, false]);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 1000);
  assert.equal(courseReport(s, [], at + 1001).active!.delayed, false);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + DAY + 2000);
  r = courseReport(s, [], at + DAY + 2001);
  assert.equal(r.active!.done, true);
  s.answers[1].excluded = true;
  assert.equal(courseReport(s, [], at + DAY + 2001).active!.done, false);
  s.answers[1].excluded = false;
  const bad = { ...bank[0], id: "q1", suspended: true };
  assert.equal(courseReport(s, [bad], at + DAY + 2001).active!.done, false);
});
test("rereading or seeing an answer just before a check prevents a delayed milestone", () => {
  const s = state();
  readCourse(s, selection, at);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 1);
  readCourse(s, selection, at + 2 * DAY);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 2 * DAY + 1);
  assert.equal(s.course.records[key].delayedAt, 0);
  attemptCourse(s, selection, "wrong", crypto.randomUUID(), at + 3 * DAY + 2);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 3 * DAY + 3);
  assert.equal(s.course.records[key].delayedAt, 0);
});
test("recent practice feedback or a delivered hint also postpones the delayed check", () => {
  const s = state();
  readCourse(s, selection, at);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 1);
  s.answers = [event(0, { at: at + 2 * DAY, correct: false })];
  assert.equal(
    courseReport(s, [], at + 2 * DAY + 1).active!.recallReady,
    false,
  );
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 2 * DAY + 2);
  assert.equal(s.course.records[key].delayedAt, 0);
  touchCourseSupport(s, key, at + 4 * DAY);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 4 * DAY + 1);
  assert.equal(s.course.records[key].delayedAt, 0);
  attemptCourse(s, selection, "7", crypto.randomUUID(), at + 5 * DAY + 2);
  assert.ok(s.course.records[key].delayedAt);
});
test("a learning route holds its concept while mixed practice and ranking cohorts remain intact", () => {
  const s = state(),
    report = studyReport(s, [], at);
  for (let n = 0; n < 6; n++)
    assert.equal(
      selectTarget(
        report,
        [],
        Array.from({ length: n }, () => selection),
      )!.topic,
      selection.topic,
    );
  const before = cohortKey(s),
    prepared = preparationKey(s);
  s.course.active = null;
  assert.equal(cohortKey(s), before);
  assert.notEqual(preparationKey(s), prepared);
  const mixed = studyReport(s, [], at),
    planned: any[] = [];
  for (let n = 0; n < 5; n++)
    planned.push(selectTarget(mixed, [], planned, undefined, () => 0)!);
  assert.equal(new Set(planned.map((p) => p.topic)).size, 5);
  s.course.active = selection;
  const q = { ...bank[0], subject: selection.subject, topic: selection.topic };
  assert.equal(courseForQuestion(s, q), undefined);
  assert.equal(
    courseForQuestion(s, {
      ...q,
      generation: {
        status: "machine_checked",
        model: "test",
        verificationModel: "test",
        checkedAt: at,
        focus: selection.lesson,
        teachingVersion: "course-1",
      },
    }),
    key,
  );
});
