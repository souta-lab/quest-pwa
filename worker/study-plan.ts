import type { Answer, LearningState } from "./engine";
import { lastReviewAt } from "./cards";
import type { Question } from "./bank";
import { subjects } from "./catalog";
import { topics, basicTopics } from "./curriculum";
import { COURSE_CONTENT_VERSION } from "../shared/course";
import {
  normalizeStudyGoal,
  defaultWeight,
  jstDay,
  type PracticeKind,
} from "../shared/study";

const DAY = 86400000;
const aliases: Record<string, string> = {
  語彙: "現代文の語彙",
  読解: "論理的文章の読解",
  古文: "古文の文法",
  漢文: "漢文の句法",
  方程式: "数と式",
  集合: "集合と命題",
  三角比: "図形と計量",
  データ分析: "データの分析",
  微分: "微分と積分",
  対数: "指数関数と対数関数",
  DNA: "遺伝情報",
  恒常性: "生物の環境応答",
  電気: "電気と磁気",
  波: "波動",
  地震: "地球の構造",
  大気: "大気と海洋",
  天体: "宇宙と天体",
  複素数平面: "平面上の曲線と複素数平面",
};
export function canonicalTopic(topic: string, subject = "") {
  const bySubject: Record<string, Record<string, string>> = {
    math1: { 確率: "場合の数と確率" },
    english: { 語彙: "語彙と文脈", 文法: "語彙と文脈", 読解: "短い英文の読解" },
    information: {
      二進法: "データの表現",
      アルゴリズム: "アルゴリズムとプログラミング",
    },
    biology: { 代謝: "細胞と分子", 遺伝: "生殖と発生" },
    chemistry: { 酸と塩基: "化学反応と平衡", 酸化還元: "化学反応と平衡" },
    japanHistory: { 近代: "近代化", 近世: "近世の政治と経済" },
    worldHistory: { 近代: "近代国家", 古代: "古代文明" },
    geography: { 気候: "自然環境", 地図: "地図と地理情報", 人口: "人口と都市" },
    politics: { 経済: "経済の仕組み", 政治: "民主政治" },
  };
  return bySubject[subject]?.[topic] ?? aliases[topic] ?? topic;
}
export const unitKey = (subject: string, topic: string) =>
  `${subject}/${canonicalTopic(topic, subject)}`;
export function mathScopeSQL(s: Pick<LearningState, "studyGoal">, alias = "q") {
  const options = normalizeStudyGoal(s.studyGoal).mathOptions;
  const excluded = [
    "数列",
    "統計的な推測",
    "ベクトル",
    "平面上の曲線と複素数平面",
  ].filter((x) => !options.includes(x));
  if (excluded.includes("平面上の曲線と複素数平面"))
    excluded.push("複素数平面");
  return excluded.length
    ? ` AND (${alias}.subject<>'math2' OR ${alias}.topic NOT IN (${excluded.map((x) => "'" + x + "'").join(",")}))`
    : "";
}
// Dependencies are teaching prerequisites, not claims about question frequency.
const prerequisites: Record<string, string[]> = {
  "math1/二次関数": ["math1/数と式"],
  "math1/図形と計量": ["math1/数と式"],
  "math1/場合の数と確率": ["math1/集合と命題"],
  "math2/三角関数": ["math1/図形と計量"],
  "math2/指数関数と対数関数": ["math1/数と式"],
  "math2/微分と積分": ["math1/二次関数"],
  "math2/数列": ["math1/数と式"],
  "math2/統計的な推測": ["math1/データの分析", "math1/場合の数と確率"],
  "math2/ベクトル": ["math1/図形と計量"],
  "math2/平面上の曲線と複素数平面": ["math2/複素数と方程式"],
  "math2/式と証明": ["math1/数と式"],
  "math2/複素数と方程式": ["math1/数と式"],
  "math2/図形と方程式": ["math1/二次関数"],
  "chemistry/化学結合": ["chemistry/物質の構成"],
  "chemistry/物質量": ["chemistry/物質の構成"],
  "chemistry/化学反応と平衡": ["chemistry/物質量"],
  "chemistry/有機化合物": ["chemistry/化学結合"],
  "chemistry/高分子": ["chemistry/有機化合物"],
  "biology/遺伝情報": ["biology/細胞と分子"],
  "biology/生殖と発生": ["biology/遺伝情報"],
  "biology/進化と系統": ["biology/遺伝情報"],
  "information/アルゴリズムとプログラミング": ["information/データの表現"],
};
export type UnitProgress = {
  key: string;
  subject: string;
  topic: string;
  attempts: number;
  independent: number;
  correct: number;
  delayed: number;
  transfer: number;
  due: number;
  lastAt: number;
  stage: "unseen" | "foundation" | "practice" | "secure";
  kind: PracticeKind;
  reason: string;
  priority: number;
  difficulty: number;
  prerequisites: string[];
  accuracy: number | null;
  interval: [number, number] | null;
};
export type PlannedUnit = { subject: string; topic: string };
export function curriculumFor(
  s: Pick<LearningState, "subjects" | "basicRanges" | "studyGoal">,
) {
  const goal = normalizeStudyGoal(s.studyGoal);
  return s.subjects.flatMap((subject) => {
    const units =
      subject === "basicScience"
        ? s.basicRanges.map((r) => basicTopics[r])
        : (topics[subject] ?? []);
    return units
      .filter(
        (topic) =>
          subject !== "math2" ||
          ![
            "数列",
            "統計的な推測",
            "ベクトル",
            "平面上の曲線と複素数平面",
          ].includes(topic) ||
          goal.mathOptions.includes(topic),
      )
      .map((topic) => ({ key: unitKey(subject, topic), subject, topic }));
  });
}
export function withinStudyScope(
  s: Pick<LearningState, "subjects" | "basicRanges" | "studyGoal">,
  q: Pick<Question, "subject" | "topic" | "basicRange">,
) {
  return (
    s.subjects.includes(q.subject) &&
    (!q.basicRange || s.basicRanges.includes(q.basicRange)) &&
    (q.subject !== "math2" ||
      canonicalTopic(q.topic) !== "平面上の曲線と複素数平面" ||
      normalizeStudyGoal(s.studyGoal).mathOptions.includes(
        "平面上の曲線と複素数平面",
      )) &&
    (q.subject !== "math2" ||
      !["数列", "統計的な推測", "ベクトル"].includes(q.topic) ||
      normalizeStudyGoal(s.studyGoal).mathOptions.includes(q.topic))
  );
}
const clean = (a: Answer) =>
  a.correct &&
  !a.hint &&
  !a.forgot &&
  a.option !== null &&
  a.responseMode !== "recognition";
function wilson(correct: number, count: number): [number, number] | null {
  if (!count) return null;
  const z = 1.96,
    p = correct / count,
    d = 1 + (z * z) / count;
  const middle = (p + (z * z) / (2 * count)) / d;
  const half =
    (z * Math.sqrt((p * (1 - p)) / count + (z * z) / (4 * count * count))) / d;
  return [
    Math.round(100 * Math.max(0, middle - half)),
    Math.round(100 * Math.min(1, middle + half)),
  ];
}
export function studyReport(
  s: LearningState,
  bank: Question[],
  now = Date.now(),
) {
  const goal = normalizeStudyGoal(s.studyGoal),
    all = curriculumFor(s);
  const byQuestion = new Map(bank.map((q) => [q.id, q]));
  const groups = new Map<string, Answer[]>();
  const valid = s.answers.filter(
    (a) =>
      !a.excluded &&
      s.subjects.includes(a.subject) &&
      !byQuestion.get(a.questionId)?.suspended,
  );
  for (const a of valid) {
    const topic = a.topic ?? byQuestion.get(a.questionId)?.topic;
    if (!topic) continue;
    const key = unitKey(a.subject, topic);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const dueByUnit = new Map<string, number>();
  for (const [qid, card] of Object.entries(s.cards)) {
    const q = byQuestion.get(qid);
    if (
      !q ||
      q.suspended ||
      !withinStudyScope(s, q) ||
      +new Date(card.dueAt) > now
    )
      continue;
    const key = unitKey(q.subject, q.topic);
    dueByUnit.set(key, (dueByUnit.get(key) ?? 0) + 1);
  }
  const daysToExam =
    (Date.parse(goal.examDate + "T00:00:00+09:00") - now) / DAY;
  const units: UnitProgress[] = all.map((u) => {
    const history = groups.get(u.key) ?? [],
      latest = history.at(-1);
    // First attempts on distinct questions are the measurement. A seen answer,
    // an example, or a hint never becomes independent evidence on later retries.
    const distinct = [
      ...new Map(
        history
          .filter((a) => a.first && !a.hint && a.responseMode !== "recognition")
          .map((a) => [a.questionId, a]),
      ).values(),
    ].slice(-20);
    const successful = distinct.filter(clean),
      recent = history.slice(-5);
    const delayed = history.filter(
      (a) =>
        a.dueReview &&
        clean(a) &&
        a.at - (lastReviewAt(a.previousCard) ?? Infinity) >= DAY,
    ).length;
    const transfer = successful.filter(
      (a) =>
        a.practiceKind === "transfer" || (!a.practiceKind && a.difficulty >= 2),
    ).length;
    const span =
      successful.length > 1 ? successful.at(-1)!.at - successful[0].at : 0;
    const recentGood = recent.filter(clean).length;
    const due = dueByUnit.get(u.key) ?? 0;
    const secure =
      successful.length >= 3 &&
      distinct.length >= 4 &&
      span >= DAY &&
      delayed >= 1 &&
      transfer >= 1 &&
      recentGood / Math.max(1, recent.length) >= 0.8 &&
      !due;
    const supportedSuccess = history.some(
      (a) => a.correct && a.hint && !a.forgot,
    );
    const needsFoundation =
      !history.length ||
      (!successful.length && !supportedSuccess) ||
      (latest &&
        (!latest.correct || latest.forgot) &&
        (!latest.errorKind || latest.errorKind === "knowledge"));
    const stage = secure
      ? "secure"
      : !history.length
        ? "unseen"
        : needsFoundation
          ? "foundation"
          : "practice";
    const kind: PracticeKind = needsFoundation
      ? "foundation"
      : successful.length >= 2
        ? "transfer"
        : "practice";
    const reason = !history.length
      ? "まだ確認していない単元。基本から確かめよう。"
      : needsFoundation
        ? "知識や解き方を補ってから、別の問題で確認しよう。"
        : kind === "transfer"
          ? "自力で解けた知識を、新しい資料や条件で使ってみよう。"
          : "ヒントを閉じて、別の問題でも解けるか確かめよう。";
    const duration = history
      .filter((a) => a.activeMs && a.activeMs >= 10000 && a.activeMs <= 300000)
      .map((a) => a.activeMs! / 1000)
      .sort((a, b) => a - b);
    const seconds =
      duration.length >= 3 ? duration[Math.floor(duration.length / 2)] : 75;
    const since = latest ? (now - latest.at) / DAY : 30;
    const priority =
      ((needsFoundation ? 1.6 : secure ? 0.25 : 1.4) *
        (1 + Math.min(0.3, Math.max(0, since) / 50))) /
      Math.sqrt(Math.max(45, seconds) / 75);
    return {
      ...u,
      attempts: history.length,
      independent: distinct.length,
      correct: successful.length,
      delayed,
      transfer,
      due,
      lastAt: latest?.at ?? 0,
      stage,
      kind,
      reason,
      priority,
      difficulty:
        needsFoundation || successful.length < 2
          ? 1
          : goal.targetPercent >= 80 &&
              daysToExam > 21 &&
              successful.length >= 4 &&
              distinct.length &&
              successful.length / distinct.length >= 0.75
            ? 3
            : 2,
      prerequisites: prerequisites[u.key] ?? [],
      accuracy: distinct.length
        ? Math.round((100 * successful.length) / distinct.length)
        : null,
      interval: wilson(successful.length, distinct.length),
    };
  });
  const map = new Map(units.map((u) => [u.key, u]));
  for (const u of units) {
    const blocked = u.prerequisites
      .map((k) => map.get(k))
      .filter((p) => p && p.correct < 2);
    if (blocked.length) u.priority *= 0.35;
    const opens = units.filter(
      (p) => p.prerequisites.includes(u.key) && p.stage !== "secure",
    ).length;
    if (u.correct < 2) u.priority *= 1 + Math.min(0.75, opens * 0.15);
    if (daysToExam <= 21 && u.kind === "transfer") u.priority *= 1.25;
    const measured = (s.examRecords ?? [])
      .filter(
        (r) =>
          r.timed &&
          now - Date.parse(r.date + "T00:00:00+09:00") <= 60 * DAY &&
          r.scores.some((x) => x.subject === u.subject),
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0]
      ?.scores.find((x) => x.subject === u.subject);
    if (measured)
      u.priority *=
        1 +
        Math.max(
          0,
          goal.targetPercent / 100 - measured.score / measured.maxScore,
        );
  }
  const bySubject = s.subjects.map((subject) => {
    const scoped = units.filter((u) => u.subject === subject),
      observations = scoped.reduce((n, u) => n + u.independent, 0),
      correct = scoped.reduce((n, u) => n + u.correct, 0);
    return {
      subject,
      name: subjects.find((x) => x.id === subject)?.name ?? subject,
      units: scoped.length,
      touched: scoped.filter((u) => u.attempts).length,
      secure: scoped.filter((u) => u.stage === "secure").length,
      observations,
      accuracy: observations
        ? Math.round((100 * correct) / observations)
        : null,
      interval: wilson(correct, observations),
      due: scoped.reduce((n, u) => n + u.due, 0),
      weight: goal.weights[subject] ?? defaultWeight(subject),
    };
  });
  const records = (s.examRecords ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((r) => {
      const scores = r.scores.filter((x) => s.subjects.includes(x.subject));
      const weight = scores.reduce(
        (n, x) => n + (goal.weights[x.subject] ?? defaultWeight(x.subject)),
        0,
      );
      return {
        ...r,
        percent: weight
          ? Math.round(
              (1000 *
                scores.reduce(
                  (n, x) =>
                    n +
                    (x.score / x.maxScore) *
                      (goal.weights[x.subject] ?? defaultWeight(x.subject)),
                  0,
                )) /
                weight,
            ) / 10
          : null,
        complete: s.subjects.every((id) =>
          scores.some((x) => x.subject === id),
        ),
        scope: scores.map((x) => x.subject),
      };
    });
  const today = valid.filter((a) => jstDay(a.at) === jstDay(now));
  const minutes =
    Math.round(today.reduce((n, a) => n + (a.activeMs ?? 0), 0) / 6000) / 10;
  const daysLeft = Math.max(
    0,
    Math.round(
      (Date.parse(goal.examDate + "T00:00:00+09:00") -
        Date.parse(jstDay(now) + "T00:00:00+09:00")) /
        DAY,
    ),
  );
  const recent = valid.filter((a) => now - a.at <= 7 * DAY);
  const totalMinutes =
    recent.reduce((n, a) => n + (a.activeMs ?? 0), 0) / 60000;
  return {
    goal,
    route: s.course?.active ?? null,
    daysLeft,
    units,
    bySubject,
    records,
    today: {
      answered: today.length,
      independent: today.filter((a) => a.first && clean(a)).length,
      recalled: today.filter((a) => a.dueReview && clean(a)).length,
      minutes,
    },
    week: {
      answered: recent.length,
      minutes: Math.round(totalMinutes),
      days: new Set(recent.map((a) => jstDay(a.at))).size,
    },
    touched: units.filter((u) => u.attempts).length,
    secure: units.filter((u) => u.stage === "secure").length,
    total: units.length,
    due: units.reduce((n, u) => n + u.due, 0),
    methodology:
      "学習の優先度は、基礎のつながり・自力正解・復習期限・配点・直近の配分を使う暫定ルール。AI問題の成績は本試験の得点予測ではありません。",
  };
}
export type StudyReport = ReturnType<typeof studyReport>;
export function selectTarget(
  report: StudyReport,
  answers: Answer[],
  planned: PlannedUnit[] = [],
  available?: PlannedUnit[],
  random = Math.random,
) {
  // A coherent learning block keeps its concept. Mixed practice still uses the
  // diversity scheduler; due FSRS reviews may interrupt either mode.
  const route = report.route;
  if (route) {
    const target = report.units.find(
      (u) =>
        u.key === unitKey(route.subject, route.topic) &&
        (!available ||
          available.some((a) => unitKey(a.subject, a.topic) === u.key)),
    );
    if (target) {
      const successes = answers.filter(
        (a) =>
          !a.excluded &&
          a.first &&
          clean(a) &&
          a.courseLesson ===
            `${route.subject}/${route.topic}/${route.lesson}` &&
          a.responseMode === "recall" &&
          a.courseVersion === COURSE_CONTENT_VERSION,
      ).length;
      const application =
        successes > 0 ||
        planned.some(
          (p) => p.subject === route.subject && p.topic === route.topic,
        );
      return {
        ...target,
        kind: (application ? "transfer" : "practice") as PracticeKind,
        difficulty: application ? 2 : 1,
        reason: `「${route.lesson}」を別の題材で使う連続学習。${application ? "次は新しい条件にも応用する。" : "最初は基本を一つ使って確かめる。"}`,
      };
    }
  }
  const recent = [...answers.filter((a) => !a.excluded).slice(-18), ...planned];
  const scope = report.units.filter(
    (u) =>
      !available ||
      available.some((a) => unitKey(a.subject, a.topic) === u.key),
  );
  const totalWeight = report.bySubject.reduce((n, s) => n + s.weight, 0) || 1;
  // Keep adaptive priorities within a subject, but give its last four units a
  // break when there are alternatives. Planned questions are part of the trail.
  const cooled = scope.filter((u) => {
    const subjectUnits = scope.filter((v) => v.subject === u.subject);
    if (subjectUnits.length <= 1) return true;
    const last = recent
      .filter((r) => r.subject === u.subject && "topic" in r && r.topic)
      .slice(-Math.min(4, subjectUnits.length - 1));
    return !last.some(
      (r) => canonicalTopic(r.topic ?? "", r.subject) === u.topic,
    );
  });
  const eligible = cooled.length ? cooled : scope;
  const scores = eligible.map((u) => {
    const subject = report.bySubject.find((s) => s.subject === u.subject)!;
    const subjectCount = recent.filter((r) => r.subject === u.subject).length;
    const subjectBalance = Math.max(
      0.25,
      ((recent.length + 3) * subject.weight) / totalWeight / (subjectCount + 1),
    );
    const unitCount = recent
      .slice(-7)
      .filter(
        (r) =>
          r.subject === u.subject &&
          "topic" in r &&
          canonicalTopic(r.topic ?? "", r.subject) === u.topic,
      ).length;
    const pending = planned.filter(
      (r) => unitKey(r.subject, r.topic) === u.key,
    ).length;
    return {
      u,
      score:
        ((u.priority * subjectBalance) /
          (1 + unitCount * 0.7 + pending * 1.5)) *
        (0.95 + random() * 0.1),
    };
  });
  scores.sort((a, b) => b.score - a.score || a.u.key.localeCompare(b.u.key));
  return scores[0]?.u ?? null;
}
