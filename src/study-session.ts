import type { Answer } from "../worker/engine";

export type Goal = 1 | 3 | 5;
type RecordedAnswer = Pick<
  Answer,
  | "instanceId"
  | "at"
  | "xp"
  | "correct"
  | "first"
  | "hint"
  | "forgot"
  | "option"
  | "responseMode"
>;
export type StudySession = {
  userId: string;
  startedAt: number;
  goal: Goal;
  checkpointStart: number;
  active: boolean;
  answers: RecordedAnswer[];
};
export const isGoal = (n: unknown): n is Goal => n === 1 || n === 3 || n === 5;
export const goalKey = (userId: string) => `quest-goal:${userId}`;
export const sessionKey = (userId: string) => `quest-study:${userId}`;
export function beginSession(
  userId: string,
  goal: Goal,
  now = Date.now(),
): StudySession {
  return {
    userId,
    goal,
    startedAt: now,
    checkpointStart: 0,
    active: true,
    answers: [],
  };
}
export function recordAnswer(s: StudySession, a: RecordedAnswer): StudySession {
  if (!s.active || a.at < s.startedAt) return s;
  const recorded = {
    instanceId: a.instanceId,
    at: a.at,
    xp: a.xp,
    correct: a.correct,
    first: a.first,
    hint: a.hint,
    forgot: a.forgot,
    option: a.option,
    responseMode: a.responseMode,
  };
  const index = s.answers.findIndex((x) => x.instanceId === a.instanceId);
  const answers = [...s.answers];
  if (index < 0) answers.push(recorded);
  else answers[index] = recorded;
  return { ...s, answers };
}
export function sessionProgress(s: StudySession | null) {
  const answers = s?.answers ?? [];
  const done = Math.max(0, answers.length - (s?.checkpointStart ?? 0));
  const goal = s?.goal ?? 3;
  return {
    total: answers.length,
    xp: answers.reduce((n, a) => n + a.xp, 0),
    newQuestions: answers.filter((a) => a.first).length,
    recalled: answers.filter(
      (a) =>
        !a.first &&
        a.correct &&
        !a.hint &&
        !a.forgot &&
        a.responseMode !== "recognition",
    ).length,
    done,
    goal,
    reached: done >= goal,
    percent: Math.min(100, (done / goal) * 100),
  };
}
export function restoreSession(
  value: string | null,
  userId: string,
  now = Date.now(),
): StudySession | null {
  try {
    const s = JSON.parse(value ?? "null") as StudySession | null;
    if (
      !s ||
      s.userId !== userId ||
      !isGoal(s.goal) ||
      !Number.isFinite(s.startedAt) ||
      s.startedAt > now ||
      now - s.startedAt > 12 * 3600000 ||
      typeof s.active !== "boolean" ||
      !Array.isArray(s.answers) ||
      s.answers.length > 20000 ||
      !Number.isInteger(s.checkpointStart) ||
      s.checkpointStart < 0 ||
      s.checkpointStart > s.answers.length
    )
      return null;
    const ids = new Set<string>();
    for (const a of s.answers) {
      if (
        !a ||
        typeof a.instanceId !== "string" ||
        ids.has(a.instanceId) ||
        !Number.isFinite(a.at) ||
        a.at < s.startedAt ||
        !Number.isFinite(a.xp) ||
        a.xp < 0 ||
        !["correct", "first", "hint", "forgot"].every(
          (k) => typeof a[k as keyof RecordedAnswer] === "boolean",
        ) ||
        (a.option !== null && typeof a.option !== "string") ||
        (a.responseMode !== undefined &&
          a.responseMode !== "recall" &&
          a.responseMode !== "recognition")
      )
        return null;
      ids.add(a.instanceId);
    }
    return s;
  } catch {
    return null;
  }
}
