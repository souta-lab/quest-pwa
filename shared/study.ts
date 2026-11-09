export const mathOptions = [
  "数列",
  "統計的な推測",
  "ベクトル",
  "平面上の曲線と複素数平面",
] as const;
export type PracticeKind = "foundation" | "practice" | "transfer" | "review";
export const practiceNames: Record<PracticeKind, string> = {
  foundation: "基礎から理解",
  practice: "自力で確認",
  transfer: "別の場面で使う",
  review: "思い出す復習",
};
export const errorNames = {
  knowledge: "知識・解き方",
  reading: "条件の読み取り",
  calculation: "計算・操作",
  time: "時間配分",
} as const;
export type ErrorKind = keyof typeof errorNames;
export type StudyGoal = {
  examDate: string;
  targetPercent: number;
  dailyMinutes: number;
  weights: Record<string, number>;
  mathOptions: string[];
};
export type ExamRecord = {
  id: string;
  date: string;
  label: string;
  timed: boolean;
  scores: { subject: string; score: number; maxScore: number }[];
};
export type StudyContext = { kind: PracticeKind; reason: string };
export const defaultWeight = (subject: string) =>
  subject === "japanese" ? 200 : 100;
export function defaultStudyGoal(): StudyGoal {
  return {
    examDate: "2027-01-16",
    targetPercent: 70,
    dailyMinutes: 20,
    weights: {},
    mathOptions: [...mathOptions.slice(0, 3)],
  };
}
export function normalizeStudyGoal(value?: Partial<StudyGoal>): StudyGoal {
  const d = defaultStudyGoal();
  return {
    ...d,
    ...value,
    weights: value?.weights ?? {},
    mathOptions: value?.mathOptions ?? d.mathOptions,
  };
}
export const jstDay = (at: number) =>
  new Date(at + 9 * 3600000).toISOString().slice(0, 10);
