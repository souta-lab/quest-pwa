import { schedule, type QuestCard, type Scheduler } from "./cards";
import type { Question } from "./bank";
import { subjects } from "./catalog";
import {
  defaultStudyGoal,
  type StudyGoal,
  type StudyContext,
  type ExamRecord,
  type ErrorKind,
  type PracticeKind,
} from "../shared/study";
import { studyReport, selectTarget, withinStudyScope } from "./study-plan";
import { courseReport, courseForQuestion } from "./course";
import {
  emptyCourse,
  type CourseState,
  type ResponseMode,
} from "../shared/course";
const banks = new WeakMap<LearningState, Question[]>();
const summaries = new WeakMap<
  LearningState,
  { total: number; eligible: number; bySubject: Record<string, number> }
>();
export function attachSummary(
  s: LearningState,
  summary: {
    total: number;
    eligible: number;
    bySubject: Record<string, number>;
  },
) {
  summaries.set(s, summary);
}

export function attachBank(s: LearningState, questions: Question[]) {
  banks.set(s, questions);
  return s;
}
export function questionsFor(s: LearningState) {
  return banks.get(s) ?? [];
}
export type Answer = {
  id: string;
  instanceId: string;
  questionId: string;
  subject: string;
  at: number;
  correct: boolean;
  option: string | null;
  hint: boolean;
  forgot: boolean;
  first: boolean;
  dueReview: boolean;
  xp: number;
  learning: number;
  difficulty: number;
  previousCard: QuestCard | null;
  drop: boolean;
  excluded?: boolean;
  topic?: string;
  practiceKind?: PracticeKind;
  activeMs?: number;
  errorKind?: ErrorKind;
  responseMode?: ResponseMode;
  recallText?: string;
  courseLesson?: string;
  courseVersion?: string;
};
export type Instance = {
  id: string;
  questionId: string;
  optionIds: string[];
  started: number;
  hint: boolean;
  dueReview: boolean;
  boosted: boolean;
  note: string;
  study?: StudyContext;
  instructionSeen?: boolean;
  courseLesson?: string;
  recallDraft?: string;
  responseMode?: ResponseMode;
};
export type LearningState = {
  subjects: string[];
  basicRanges: string[];
  xp: number;
  combo: number;
  bestCombo: number;
  cards: Record<string, QuestCard>;
  answers: Answer[];
  instance: Instance | null;
  inventory: number;
  boostRemaining: number;
  boostLease: string | null;
  boostAt: number;
  boostActive: boolean;
  highestRank: number;
  titles: string[];
  generationMode: boolean;
  settings: { sound: boolean; motion: boolean };
  studyGoal: StudyGoal;
  examRecords: ExamRecord[];
  course: CourseState;
};
export function initialState(questions: Question[] = []): LearningState {
  return attachBank(
    {
      subjects: [],
      generationMode: false,
      basicRanges: ["biology", "chemistry"],
      xp: 0,
      combo: 0,
      bestCombo: 0,
      cards: {},
      answers: [],
      instance: null,
      inventory: 0,
      boostRemaining: 0,
      boostLease: null,
      boostAt: 0,
      boostActive: false,
      highestRank: 0,
      titles: [],
      settings: { sound: true, motion: true },
      studyGoal: defaultStudyGoal(),
      examRecords: [],
      course: emptyCourse(),
    },
    questions,
  );
}
export function shuffle<T>(xs: T[], random = Math.random) {
  const copy = [...xs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function eligible(s: LearningState) {
  return questionsFor(s).filter((q) => !q.suspended && withinStudyScope(s, q));
}
export function next(s: LearningState, now = Date.now(), random = Math.random) {
  if (s.instance) return publicInstance(s);
  const qs = eligible(s);
  if (!qs.length) throw Error("科目を選択してください。");
  const available = [...new Set(qs.map((q) => q.subject))];
  const subject = available[Math.floor(random() * available.length)];
  const pool = qs.filter((q) => q.subject === subject);
  const unseen = pool.filter((q) => !s.cards[q.id]);
  const due = pool.filter(
    (q) => s.cards[q.id] && +new Date(s.cards[q.id].dueAt) <= now,
  );
  const ratio = Math.min(0.75, 0.25 + due.length * 0.025);
  let pick: Question;
  let review = false;
  if (due.length && (!unseen.length || random() < ratio)) {
    pick = due.sort(
      (a, b) => +new Date(s.cards[a.id].dueAt) - +new Date(s.cards[b.id].dueAt),
    )[0];
    review = true;
  } else if (unseen.length) pick = unseen[Math.floor(random() * unseen.length)];
  else {
    const repeated = pool.filter((q) => q.id !== s.answers.at(-1)?.questionId);
    const rest = repeated.length ? repeated : pool;
    pick = rest[Math.floor(random() * rest.length)];
  }
  s.instance = {
    id: crypto.randomUUID(),
    questionId: pick.id,
    optionIds: shuffle(
      pick.options.map((o) => o.id),
      random,
    ),
    started: now,
    hint: false,
    dueReview: review,
    boosted: s.boostRemaining > 0,
    note: "",
  };
  return publicInstance(s);
}
export function publicInstance(s: LearningState) {
  if (!s.instance) return null;
  const i = s.instance;
  const q = questionsFor(s).find((q) => q.id === i.questionId)!;
  const { correct, explanation, hints, generation, ...safe } = q;
  const answer = s.answers.find((a) => a.instanceId === i.id);
  return {
    ...i,
    courseLesson: courseForQuestion(s, q),
    question: {
      ...safe,
      ...(generation
        ? {
            generation: {
              status: generation.status,
              model: generation.model,
              verificationModel: generation.verificationModel,
              checkedAt: generation.checkedAt,
            },
          }
        : {}),
      options: i.optionIds.map((id) => q.options.find((o) => o.id === id)!),
    },
    answered: answer ? answerResult(s, answer) : null,
  };
}
function answerResult(s: LearningState, a: Answer) {
  const q = questionsFor(s).find((q) => q.id === a.questionId)!;
  return {
    ...a,
    previousCard: undefined,
    correctOption: q.correct,
    explanation: q.explanation,
    combo: s.combo,
    // Public API contract keeps the `due` name.
    due: s.cards[q.id].dueAt,
  };
}
export function answer(
  s: LearningState,
  scheduler: Scheduler,
  instanceId: string,
  option: string | null,
  now = Date.now(),
  random = Math.random,
) {
  const prior = s.answers.find((a) => a.instanceId === instanceId);
  if (prior) return answerResult(s, prior);
  const i = s.instance;
  if (!i || i.id !== instanceId)
    throw Error("この問題は終了しています。再読み込みしてください。");
  const q = questionsFor(s).find((q) => q.id === i.questionId)!;
  if (option !== null && !q.options.some((o) => o.id === option))
    throw Error("選択肢が無効です。");
  const first = !s.cards[q.id];
  const previousCard = s.cards[q.id] ?? null;
  const correct = option === q.correct;
  const qualified = first || i.dueReview;
  s.combo = correct ? s.combo + 1 : 0;
  s.bestCombo = Math.max(s.combo, s.bestCombo);
  const base = Math.round(
    10 * (1 + q.difficulty * 0.3) * Math.max(1, q.expectedSeconds / 45),
  );
  const xp = qualified
    ? Math.round(
        base *
          (correct ? 1 : 0.2) *
          (1 + Math.min(s.combo, 10) * 0.02) *
          (i.boosted ? 1.5 : 1),
      )
    : 0;
  const learning = qualified
    ? base *
      (correct ? 1 : 0.2) *
      (correct && !i.hint && i.responseMode !== "recognition" ? 1.2 : 1)
    : 0;
  const drop = random() < 0.025;
  const a: Answer = {
    id: crypto.randomUUID(),
    instanceId: i.id,
    questionId: q.id,
    subject: q.subject,
    at: now,
    correct,
    option,
    hint: i.hint,
    forgot: false,
    first,
    dueReview: i.dueReview,
    xp,
    learning,
    difficulty: q.difficulty,
    topic: q.topic,
    practiceKind: i.study?.kind ?? (i.dueReview ? "review" : "practice"),
    previousCard,
    drop,
    responseMode: i.responseMode,
    recallText: i.recallDraft,
    courseLesson: i.courseLesson ?? courseForQuestion(s, q),
    courseVersion: q.generation?.teachingVersion,
  };
  s.answers.push(a);
  s.cards[q.id] = schedule(
    scheduler,
    previousCard,
    q.id,
    now,
    !correct || i.hint,
  );
  s.xp += xp;
  if (drop) s.inventory++;
  awardTitles(s);
  const current = overview(s, now);
  s.highestRank = Math.max(s.highestRank, current.rankIndex);
  return answerResult(s, a);
}
// App-level "I didn't actually remember" correction (not the library's forget):
// replay this question's answers from the pre-answer snapshot.
export function forget(
  s: LearningState,
  scheduler: Scheduler,
  instanceId: string,
) {
  const target = s.answers.find((a) => a.instanceId === instanceId);
  if (!target || !target.correct)
    throw Error("正解した回答を指定してください。");
  if (target.forgot) return;
  target.forgot = true;
  const subsequent = s.answers
    .slice(s.answers.indexOf(target))
    .filter((a) => a.questionId === target.questionId);
  let card = target.previousCard;
  for (const a of subsequent)
    card = schedule(
      scheduler,
      card,
      target.questionId,
      a.at,
      !a.correct || a.hint || a.forgot,
    );
  s.cards[target.questionId] = card!;
}
export function heartbeat(
  s: LearningState,
  lease: string,
  active: boolean,
  now = Date.now(),
) {
  if (
    s.boostLease &&
    s.boostLease !== lease &&
    s.boostActive &&
    now - s.boostAt < 15000
  )
    throw Error("別の画面でブーストを使用中です。");
  if (s.boostLease === lease && s.boostActive)
    s.boostRemaining = Math.max(
      0,
      s.boostRemaining - Math.min(10, Math.max(0, (now - s.boostAt) / 1000)),
    );
  s.boostLease = lease;
  s.boostAt = now;
  s.boostActive = active && s.boostRemaining > 0;
  return s.boostRemaining;
}
export const rankNames = ["D", "C", "B", "A", "S", "SS", "SSS"];
export function overview(s: LearningState, now = Date.now()) {
  const study = studyReport(s, questionsFor(s), now);
  const course = courseReport(s, questionsFor(s), now);
  const total = s.answers.length,
    correct = s.answers.filter((a) => a.correct).length;
  const qs = eligible(s);
  const recent = s.answers.filter(
    (a) => !a.excluded && now - a.at < 28 * 86400000,
  );
  const dueReviews = recent.filter((a) => a.dueReview);
  const reviewSuccess = dueReviews.length
    ? dueReviews.filter((a) => a.correct && !a.forgot && !a.hint).length /
      dueReviews.length
    : 0;
  const bySubject = s.subjects.map((id) => {
    const answers = s.answers.filter((a) => a.subject === id);
    const observations = answers.filter(
      (a) => a.first && !a.hint && !a.excluded && !a.forgot,
    );
    let theta = 0,
      precision = 1;
    for (const a of observations) {
      const difficulty = (a.difficulty - 2) * 0.8;
      const logistic = 1 / (1 + Math.exp(-(theta - difficulty)));
      const p = 0.25 + 0.75 * logistic;
      const gradient = 0.75 * logistic * (1 - logistic);
      const info = (gradient * gradient) / (p * (1 - p));
      theta +=
        (gradient * ((a.correct ? 1 : 0) - p)) /
        (p * (1 - p) * (precision + info));
      precision += info;
    }
    return {
      id,
      name: subjects.find((x) => x.id === id)?.name ?? id,
      answered: answers.length,
      correct: answers.filter((a) => a.correct).length,
      observations: observations.length,
      rating: Math.round(1000 + theta * 200),
      uncertainty: Math.round(200 / Math.sqrt(precision)),
      due: qs.filter(
        (q) =>
          q.subject === id &&
          s.cards[q.id] &&
          +new Date(s.cards[q.id].dueAt) <= now,
      ).length,
    };
  });
  const measured = bySubject.filter((x) => x.observations);
  const skill = measured.length
    ? Math.max(
        0,
        Math.min(
          100,
          measured.reduce((sum, x) => sum + (x.rating - 600) / 8, 0) /
            measured.length,
        ),
      )
    : 0;
  const allowedIds = new Set(qs.map((q) => q.id));
  const learned = new Set(
    s.answers
      .filter((a) => allowedIds.has(a.questionId))
      .map((a) => a.questionId),
  ).size;
  const denominator = summaries.get(s)?.eligible ?? qs.length;
  const coverage = denominator ? learned / denominator : 0;
  const learning =
    Math.min(100, recent.reduce((sum, a) => sum + a.learning, 0) / 20) * 0.6 +
    reviewSuccess * 25 +
    coverage * 15;
  const score = 0.5 * skill + 0.5 * learning;
  const thresholds = [0, 15, 30, 45, 60, 75, 90];
  let rankIndex = thresholds.filter((x) => score >= x).length - 1;
  if (
    rankIndex === 6 &&
    (skill < 85 || learning < 85 || measured.some((x) => x.observations < 30))
  )
    rankIndex = 5;
  if (measured.length < s.subjects.length) rankIndex = Math.min(rankIndex, 3);
  const level = Math.floor(Math.sqrt(s.xp / 80)) + 1;
  const levelStart = 80 * (level - 1) ** 2,
    nextLevelXp = 80 * level ** 2;
  return {
    total,
    correct,
    xp: s.xp,
    level,
    levelStart,
    nextLevelXp,
    combo: s.combo,
    bestCombo: s.bestCombo,
    inventory: s.inventory,
    boostRemaining: s.boostRemaining,
    rankIndex,
    rank: rankNames[rankIndex],
    highestRank: rankNames[Math.max(rankIndex, s.highestRank)],
    skill: Math.round(skill),
    learning: Math.round(learning),
    score: Math.round(score),
    due: bySubject.reduce((sum, x) => sum + x.due, 0),
    bySubject,
    titles: s.titles,
    coverage: Math.round(coverage * 100),
    recentCount: recent.length,
    retention: Math.round(reviewSuccess * 100),
    reviewCount: dueReviews.length,
    bankCount: summaries.get(s)?.total ?? questionsFor(s).length,
    settings: s.settings,
    subjects: s.subjects,
    basicRanges: s.basicRanges,
    generationMode: s.generationMode,
    course,
    study: {
      ...study,
      recommendation: selectTarget(study, s.answers, [], undefined, () => 0.5),
    },
    calibration: {
      status: "データ不足",
      message:
        "共テ得点率・模試換算・偏差値は、実際の試験成績と基準集団で校正してから表示します。",
    },
  };
}
function awardTitles(s: LearningState) {
  const add = (name: string) => {
    if (!s.titles.includes(name)) s.titles.push(name);
  };
  if (s.answers.length) add("最初の一歩");
  if (s.answers.length >= 10) add("十問十色");
  if (s.answers.length >= 100) add("百戦錬磨");
  if (s.bestCombo >= 5) add("五連の閃き");
  if (s.bestCombo >= 10) add("止まらない思考");
  if (
    s.answers.filter(
      (a) => a.correct && a.first && !a.hint && a.difficulty >= 3,
    ).length >= 3
  )
    add("難問の突破者");
  const days = new Set(
    s.answers.map((a) =>
      new Date(a.at + 9 * 3600000).toISOString().slice(0, 10),
    ),
  );
  if (days.size >= 7) add("七日の軌跡");
  if (
    new Set(s.answers.filter((a) => a.correct).map((a) => a.subject)).size >= 6
  )
    add("六教科の旅人");
  for (const subject of s.subjects) {
    const qs = questionsFor(s).filter((q) => q.subject === subject);
    if (
      (summaries.get(s)?.bySubject[subject] ?? qs.length) >= 20 &&
      qs.length === (summaries.get(s)?.bySubject[subject] ?? qs.length) &&
      qs.every((q) =>
        s.answers.some((a) => a.questionId === q.id && a.correct && !a.hint),
      ) &&
      s.answers.filter((a) => a.subject === subject && a.dueReview && a.correct)
        .length >= 20
    )
      add(`${subjects.find((x) => x.id === subject)?.name}の探究者`);
  }
}
