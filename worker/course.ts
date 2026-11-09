import type { Question } from "./bank";
import type { Answer, LearningState } from "./engine";
import { courseLessons } from "./course-content";
import { checkRecall, recallChecks } from "./course-checks";
import { curriculumFor } from "./study-plan";
import {
  COURSE_CONTENT_VERSION,
  courseKey,
  emptyCourse,
  type CourseSelection,
  type RecallRecord,
} from "../shared/course";
import { fail } from "./security";
const DAY = 86400000;
const freshRecord = (): RecallRecord => ({
  readAt: 0,
  attempts: 0,
  firstCorrectAt: 0,
  lastCorrectAt: 0,
  delayedAt: 0,
  lastAttemptAt: 0,
  lastCorrect: false,
});
export function selectedCourse(s: LearningState, selection: CourseSelection) {
  const unit = curriculumFor(s).find(
    (u) => u.subject === selection.subject && u.topic === selection.topic,
  );
  const lesson =
    unit &&
    courseLessons(unit.subject, unit.topic).find(
      (l) => l.title === selection.lesson,
    );
  if (!unit || !lesson) fail(400, "選択した受験範囲の教材を選んでください。");
  return { unit, lesson };
}
export function readCourse(
  s: LearningState,
  selection: CourseSelection,
  now = Date.now(),
) {
  const { lesson } = selectedCourse(s, selection);
  s.course ??= emptyCourse();
  const key = courseKey(selection);
  s.course.records[key] ??= freshRecord();
  s.course.records[key].readAt = now;
  return lesson;
}
export function touchCourseSupport(
  s: LearningState,
  key?: string,
  now = Date.now(),
) {
  if (!key) return;
  s.course ??= emptyCourse();
  s.course.records[key] ??= freshRecord();
  s.course.records[key].lastSupportAt = now;
}
function lastExposure(
  s: LearningState,
  key: string,
  r: RecallRecord,
  before = Infinity,
  history: Answer[] = s.answers,
) {
  const support = Math.max(
    0,
    ...[r.readAt, r.lastAttemptAt, r.lastSupportAt ?? 0].filter(
      (at) => at < before,
    ),
  );
  return history.reduce(
    (latest, a) =>
      a.courseLesson === key && a.at < before ? Math.max(latest, a.at) : latest,
    support,
  );
}
export function attemptCourse(
  s: LearningState,
  selection: CourseSelection,
  input: string,
  requestId: string,
  now = Date.now(),
) {
  const { lesson } = selectedCourse(s, selection),
    key = courseKey(selection);
  const r = s.course?.records[key];
  if (!r?.readAt) fail(409, "先にこの論点の教材を開いてください。");
  const check = recallChecks[lesson.title];
  if (r.lastRequestId === requestId)
    return {
      correct: r.lastCorrect,
      answer: check.answers[0],
      explanation: check.explanation,
    };
  const correct = checkRecall(check, input);
  const delayed =
    correct && !!r.firstCorrectAt && now - lastExposure(s, key, r) >= DAY;
  r.attempts++;
  r.lastAttemptAt = now;
  r.lastRequestId = requestId;
  r.lastCorrect = correct;
  if (correct) {
    r.firstCorrectAt ||= now;
    r.lastCorrectAt = now;
    if (delayed) r.delayedAt = now;
  } else r.delayedAt = 0;
  return { correct, answer: check.answers[0], explanation: check.explanation };
}
export function courseForQuestion(s: LearningState, q: Question) {
  const focus = q.generation?.focus;
  if (
    !focus ||
    q.generation?.teachingVersion !== COURSE_CONTENT_VERSION ||
    !curriculumFor(s).some(
      (u) => u.subject === q.subject && u.topic === q.topic,
    )
  )
    return undefined;
  // Do not attribute an unrelated old bank question to a lesson just because it
  // shares a broad unit. Generated plans carry the exact teaching objective.
  if (courseLessons(q.subject, q.topic).some((l) => l.title === focus)) {
    const selection = { subject: q.subject, topic: q.topic, lesson: focus },
      key = courseKey(selection);
    if (
      (s.course?.active && courseKey(s.course.active) === key) ||
      s.course?.records[key]?.readAt
    )
      return key;
  }
  return undefined;
}
const independent = (a: Answer) =>
  a.correct &&
  !a.hint &&
  !a.forgot &&
  a.option !== null &&
  a.responseMode === "recall" &&
  a.courseVersion === COURSE_CONTENT_VERSION &&
  !!a.recallText?.trim();
export function courseReport(
  s: LearningState,
  bank: Question[],
  now = Date.now(),
) {
  const c = s.course ?? emptyCourse(),
    qs = new Map(bank.map((q) => [q.id, q]));
  const trails = new Map<string, Answer[]>();
  for (const a of s.answers) {
    if (!a.courseLesson) continue;
    if (!trails.has(a.courseLesson)) trails.set(a.courseLesson, []);
    trails.get(a.courseLesson)!.push(a);
  }
  const units = curriculumFor(s).map((unit) => ({
    ...unit,
    lessons: courseLessons(unit.subject, unit.topic).map((lesson) => {
      const selection = {
        subject: unit.subject,
        topic: unit.topic,
        lesson: lesson.title,
      };
      const key = courseKey(selection),
        r = c.records[key] ?? freshRecord();
      const allHistory = trails.get(key) ?? [];
      const history = allHistory.filter(
        (a) => !a.excluded && !qs.get(a.questionId)?.suspended,
      );
      const proof = [
        ...new Map(
          history
            .filter((a) => a.first && independent(a))
            .map((a) => [a.questionId, a]),
        ).values(),
      ];
      const transfer = proof.filter(
        (a) => a.practiceKind === "transfer",
      ).length;
      const delayedAnswer = history.some(
        (a) =>
          a.dueReview &&
          independent(a) &&
          a.previousCard?.last_review &&
          a.at - +new Date(a.previousCard.last_review) >= DAY &&
          a.at - lastExposure(s, key, r, a.at, allHistory) >= DAY,
      );
      const delayed = !!r.delayedAt || delayedAnswer;
      const applied = proof.length >= 2 && transfer >= 1;
      const reproduced = !!r.firstCorrectAt && r.lastCorrect;
      const steps = [!!r.readAt, reproduced, applied, delayed];
      const done = steps.every(Boolean);
      const next = steps.findIndex((x) => !x);
      const exposure = lastExposure(s, key, r, Infinity, allHistory);
      return {
        key,
        ...selection,
        title: lesson.title,
        prompt: lesson.prompt,
        steps,
        done,
        stage: done ? 4 : Math.max(0, next),
        proof: proof.length,
        transfer,
        read: !!r.readAt,
        reproduced,
        delayed,
        dueAt: r.lastAttemptAt ? exposure + DAY : null,
        recallReady: !delayed && !!r.firstCorrectAt && now - exposure >= DAY,
        attempts: history.length,
      };
    }),
  }));
  const lessons = units.flatMap((u) => u.lessons);
  const activeKey = c.active ? courseKey(c.active) : null;
  const active = lessons.find((l) => l.key === activeKey) ?? null;
  const activeIndex = active
    ? lessons.findIndex((l) => l.key === active.key)
    : -1;
  const next =
    active?.steps[2] && !active.recallReady
      ? (lessons.slice(activeIndex + 1).find((l) => !l.steps[2]) ??
        lessons.find((l) => !l.steps[2]) ??
        active)
      : (active ??
        lessons.find((l) => l.recallReady) ??
        lessons.find((l) => !l.done) ??
        lessons[0] ??
        null);
  return {
    active,
    next,
    units,
    total: lessons.length,
    read: lessons.filter((l) => l.read).length,
    reproduced: lessons.filter((l) => l.reproduced).length,
    applied: lessons.filter((l) => l.steps[2]).length,
    retained: lessons.filter((l) => l.done).length,
    recallDue: lessons.filter((l) => l.recallReady).length,
    points: lessons.reduce((n, l) => n + l.steps.filter(Boolean).length, 0),
    totalPoints: lessons.length * 4,
  };
}
