export type CourseSelection = {
  subject: string;
  topic: string;
  lesson: string;
};
export const COURSE_CONTENT_VERSION = "course-1";
export type RecallRecord = {
  readAt: number;
  attempts: number;
  firstCorrectAt: number;
  lastCorrectAt: number;
  delayedAt: number;
  lastAttemptAt: number;
  lastCorrect: boolean;
  lastRequestId?: string;
  lastSupportAt?: number;
};
export type CourseState = {
  active: CourseSelection | null;
  records: Record<string, RecallRecord>;
};
export const courseKey = (s: CourseSelection) =>
  `${s.subject}/${s.topic}/${s.lesson}`;
export const emptyCourse = (): CourseState => ({ active: null, records: {} });
export const courseSteps = ["教材", "記述で再現", "別問で使う", "翌日以降"];
export type ResponseMode = "recall" | "recognition";
