import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Flag,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { subjects } from "../worker/catalog";
import {
  defaultWeight,
  mathOptions,
  practiceNames,
  errorNames,
  jstDay,
  type StudyGoal,
  type ExamRecord,
  type ErrorKind,
} from "../shared/study";
import type { overview, publicInstance } from "../worker/engine";
import type { foundationLesson } from "../worker/study-lessons";
import { MathText } from "./MathText";
import { api } from "./api";
import { CourseTrail } from "./CoursePage";

type Overview = ReturnType<typeof overview>;
type Instance = NonNullable<ReturnType<typeof publicInstance>>;
type Perform = (fn: () => Promise<void>) => Promise<void>;
const subjectName = (id: string) =>
  subjects.find((s) => s.id === id)?.name ?? id;
const stageNames = {
  unseen: "未確認",
  foundation: "基礎を補う",
  practice: "練習中",
  secure: "定着を確認",
};

export function StudyHome({
  o,
  goal,
  onGoal,
  onStart,
  onPractice,
  onStats,
  onSettings,
  busy,
  resuming,
}: {
  o: Overview;
  goal: 1 | 3 | 5;
  onGoal: (g: 1 | 3 | 5) => void;
  onStart: () => void;
  onPractice: () => void;
  onStats: () => void;
  onSettings: () => void;
  busy: boolean;
  resuming: boolean;
}) {
  const s = o.study,
    next = s.recommendation,
    chapter = o.course.next ?? o.course.active;
  return (
    <>
      <div className="page-heading study-heading">
        <div>
          <span className="eyebrow">
            <i aria-hidden="true" /> VERDICT: REJECTED
          </span>
          <h1 aria-label="その評価、覆せ。">
            その評価、<span>覆せ。</span>
          </h1>
          <p className="ignition-message">
            限界を決めたのは誰だ。次の答案で、答えを出せ。
          </p>
        </div>
        <button
          className="exam-countdown"
          onClick={onSettings}
          aria-label="受験目標を変更"
        >
          <Flag size={16} />
          <span>
            試験まで <b>{s.daysLeft}</b> 日
          </span>
        </button>
      </div>
      <section className="study-hero" aria-label="次の学習">
        <div className="mission-art" aria-hidden="true">
          <svg viewBox="0 0 260 260" fill="none">
            <path d="M20 48h179l41 41v127H61l-41-41z" />
            <path className="mission-arc" d="m13 222 113-193m26 193L247 58" />
            <path d="M20 38V19h49m171 204v18h-50" />
          </svg>
          <span>TAKE IT BACK</span>
          <b>{String(goal).padStart(2, "0")}</b>
          <small>YOUR NEXT MOVE</small>
        </div>
        <div className="study-hero-top">
          <span className="pill light">
            <Sparkles size={15} /> 知識をつなぐ学習ルート
          </span>
          <span>目標 {s.goal.targetPercent}%</span>
        </div>
        <span className="mission-label">NEXT CHAPTER / 次に身につける知識</span>
        <p className="study-subject">
          {chapter
            ? `${subjectName(chapter.subject)} · ${chapter.topic}`
            : "受験科目から"}
        </p>
        <h2>{chapter?.title ?? "知識を、つなげていこう。"}</h2>
        <p className="study-reason">
          {chapter?.reproduced
            ? `記述で再現できた。次は別問で使う。自力確認 ${Math.min(2, chapter.proof)}/2問。`
            : "知識と例をつかみ、教材を閉じて再現する。その知識を別の問題につなぐ。"}
        </p>
        {chapter && <CourseTrail steps={chapter.steps} compact />}
        <div className="study-start-row">
          <button
            className="button lime start-button"
            disabled={busy}
            onClick={onStart}
          >
            <BookOpen size={20} />
            {o.course.active ? "学習ルートを続ける" : "知識から、攻略を始める"}
            <ArrowRight size={19} />
          </button>
        </div>
        <details className="practice-shortcut">
          <summary>演習から始める・区切りを選ぶ</summary>
          <div className="study-start-row">
            <fieldset className="goal-picker">
              <legend>今回の目標を選ぶ</legend>
              {([1, 3, 5] as const).map((n) => (
                <button
                  type="button"
                  key={n}
                  aria-pressed={goal === n}
                  onClick={() => onGoal(n)}
                >
                  {n}問
                </button>
              ))}
            </fieldset>
            <button
              className="button outlined"
              disabled={busy}
              onClick={onPractice}
            >
              {busy ? (
                <LoaderCircle size={20} className="spin" />
              ) : (
                <ArrowRight size={20} />
              )}{" "}
              {resuming ? "続きから学ぶ" : `${goal}問から始める`}
            </button>
          </div>
        </details>
        <div className="study-route" aria-label="学習の流れ">
          <span>
            <Lightbulb size={15} />
            例から理解
          </span>
          <ChevronRight size={14} />
          <span>
            <Target size={15} />
            書いて確認
          </span>
          <ChevronRight size={14} />
          <span>
            <RotateCcw size={15} />
            別問と後日の確認
          </span>
        </div>
        <small>4択が当たっただけでは、知識の確認は進まない。</small>
      </section>
      <section className="today-card" aria-label="今日の学習">
        <div>
          <span className="today-icon">
            <TrendingUp size={23} />
          </span>
          <div>
            <h3>使える知識を、積み上げる。</h3>
            <p>
              累計 · 記述で再現した論点 <b>{o.course.reproduced}</b> ·
              別問でも使えた <b>{o.course.applied}</b>
            </p>
            <p className="today-evidence">
              <span>
                今日の初見・自力正解 <b>{s.today.independent}</b>
              </span>
              <span>
                後日まで確認した論点 <b>{o.course.retained}</b>
              </span>
            </p>
          </div>
        </div>
        <div className="today-time">
          <span>
            <Clock3 size={15} />
            {s.today.minutes} / {s.goal.dailyMinutes}分
          </span>
          <progress
            value={Math.min(s.today.minutes, s.goal.dailyMinutes)}
            max={s.goal.dailyMinutes}
            aria-label="今日の学習時間の目安"
          />
          <small>
            {s.today.minutes >= s.goal.dailyMinutes
              ? "今日の時間目標、到達。"
              : "1問から、今日の記録が動き出す。"}
          </small>
        </div>
      </section>
      <div className="study-home-grid">
        <button className="study-link-card" onClick={onStats}>
          <span className="study-card-icon">
            <BookOpen size={24} />
          </span>
          <div>
            <strong>伸びた実力を、記録で確かめる</strong>
            <p>単元の定着・過去問の得点記録</p>
            <span>
              {s.touched}/{s.total}単元に着手 · 復習待ち {s.due}問
            </span>
          </div>
          <ChevronRight size={19} />
        </button>
        <div className="study-level-card">
          <Sparkles size={22} />
          <div>
            <strong>Lv.{o.level}</strong>
            <span>次のレベルまで {o.nextLevelXp - o.xp} XP</span>
            <progress
              value={o.xp - o.levelStart}
              max={o.nextLevelXp - o.levelStart}
              aria-label="次のレベルまで"
            />
          </div>
          <b>{o.rank}</b>
        </div>
      </div>
    </>
  );
}

export function GoalSettings({
  o,
  busy,
  perform,
  onSaved,
}: {
  o: Overview;
  busy: boolean;
  perform: Perform;
  onSaved: (r: any) => void;
}) {
  const [goal, setGoal] = useState<StudyGoal>(o.study.goal);
  return (
    <section className="card study-goal-settings">
      <div className="section-title">
        <h3>受験の目標</h3>
        <span className="pill subtle">出題の優先度に反映</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => onSaved(await api("/study-goal", goal)));
        }}
      >
        <div className="goal-form-grid">
          <label>
            試験日
            <input
              type="date"
              required
              min="2026-01-01"
              max="2035-12-31"
              value={goal.examDate}
              onChange={(e) => setGoal({ ...goal, examDate: e.target.value })}
            />
          </label>
          <label>
            目標得点率（%）
            <input
              type="number"
              required
              min={1}
              max={100}
              value={goal.targetPercent}
              onChange={(e) =>
                setGoal({ ...goal, targetPercent: Number(e.target.value) })
              }
            />
          </label>
          <label>
            1日の時間の目安（分）
            <input
              type="number"
              required
              min={5}
              max={240}
              step={5}
              value={goal.dailyMinutes}
              onChange={(e) =>
                setGoal({ ...goal, dailyMinutes: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <details>
          <summary>科目の配点・数学の選択範囲</summary>
          <p className="muted">
            志望先の換算後の配点を入力。配点が大きい科目と、得点記録で弱い科目に時間を配る。
          </p>
          <div className="weight-inputs">
            {o.subjects.map((id) => (
              <label key={id}>
                {subjectName(id)}
                <input
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={goal.weights[id] ?? defaultWeight(id)}
                  onChange={(e) =>
                    setGoal({
                      ...goal,
                      weights: {
                        ...goal.weights,
                        [id]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {o.subjects.includes("math2") && (
            <fieldset className="math-choice">
              <legend>数学Ⅱ・B・Cの選択項目（3つ）</legend>
              {mathOptions.map((t) => (
                <label key={t}>
                  <input
                    type="checkbox"
                    checked={goal.mathOptions.includes(t)}
                    onChange={(e) =>
                      setGoal({
                        ...goal,
                        mathOptions: e.target.checked
                          ? [...goal.mathOptions, t]
                          : goal.mathOptions.filter((x) => x !== t),
                      })
                    }
                  />
                  {t}
                </label>
              ))}
              <small>
                {goal.mathOptions.length}
                /3項目を選択。数学Ⅱの必須範囲は全て学習する。
              </small>
            </fieldset>
          )}
        </details>
        <button
          type="submit"
          className="button primary"
          disabled={busy || goal.mathOptions.length !== 3}
        >
          目標を保存 <Check size={17} />
        </button>
        <p className="field-note">
          英語はリーディングが対象。リスニングと本番の総合的な時間配分は、音声教材・過去問でも補おう。
        </p>
      </form>
    </section>
  );
}

export function FoundationPanel({
  instance,
  perform,
  onInstance,
}: {
  instance: Instance;
  perform: Perform;
  onInstance: (i: Instance) => void;
}) {
  const [lesson, setLesson] = useState<ReturnType<
      typeof foundationLesson
    > | null>(null),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  return (
    <div className={"foundation-panel " + (open ? "is-open" : "")}>
      {!open ? (
        <div className="foundation-invitation">
          <Lightbulb size={20} />
          <div>
            <strong>
              {instance.study?.kind === "foundation"
                ? "初めてなら、例から学ぼう。"
                : "解き方を確認したいときに。"}
            </strong>
            <small>知識 → 別の例題 → この問題で練習</small>
          </div>
          <button
            className="button outlined"
            disabled={loading}
            onClick={() => {
              if (lesson) {
                setOpen(true);
                return;
              }
              setLoading(true);
              setError("");
              void perform(async () => {
                try {
                  const r = await api("/lesson", { instanceId: instance.id });
                  setLesson(r.lesson);
                  onInstance(r.instance);
                  setOpen(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoading(false);
                }
              });
            }}
          >
            {loading ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              "基礎を読む"
            )}
          </button>
        </div>
      ) : (
        lesson && (
          <>
            <div className="foundation-title">
              <span className="pill subtle">
                <Lightbulb size={14} />
                基礎を理解
              </span>
              <button
                className="icon-button"
                aria-label="基礎教材を閉じる"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <h3>{lesson.title}</h3>
            <p>
              <MathText text={lesson.knowledge} />
            </p>
            <p className="foundation-method">
              <MathText text={lesson.method} />
            </p>
            {lesson.example && (
              <section className="worked-example">
                <span className="eyebrow">いっしょに解く例</span>
                <h4>
                  <MathText text={lesson.example.problem} />
                </h4>
                <ol>
                  {lesson.example.steps.map((s, n) => (
                    <li key={n}>
                      <MathText text={s} />
                    </li>
                  ))}
                </ol>
                <div className="worked-example-conclusion">
                  <Check size={17} />
                  <span>
                    <MathText text={lesson.example.conclusion} />
                  </span>
                </div>
              </section>
            )}
            <p className="foundation-recall">{lesson.recall}</p>
            <button
              className="button primary"
              onClick={() => {
                setOpen(false);
                document.querySelector<HTMLElement>(".question-stem")?.focus();
              }}
            >
              例を閉じて、問題を解く <ArrowRight size={17} />
            </button>
            <small>
              この回答は教材を見た練習として記録。自力で解けるかは次の初見問題で確かめる。
            </small>
          </>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function Reflection({
  instance,
  busy,
  perform,
  onSaved,
}: {
  instance: Instance;
  busy: boolean;
  perform: Perform;
  onSaved: (r: any) => void;
}) {
  const a = instance.answered;
  if (!a || (a.correct && !a.hint && !a.forgot)) return null;
  return (
    <fieldset className="error-reflection">
      <legend>
        次に補いたいところ <small>任意 · 次の学習に反映</small>
      </legend>
      {(Object.entries(errorNames) as [ErrorKind, string][]).map(
        ([kind, name]) => (
          <button
            type="button"
            key={kind}
            disabled={busy}
            aria-pressed={a.errorKind === kind}
            onClick={() =>
              void perform(async () =>
                onSaved(
                  await api("/reflection", { instanceId: instance.id, kind }),
                ),
              )
            }
          >
            {a.errorKind === kind && <Check size={13} />} {name}
          </button>
        ),
      )}
    </fieldset>
  );
}

export function LearningProgress({
  o,
  busy,
  perform,
  onOverview,
}: {
  o: Overview;
  busy: boolean;
  perform: Perform;
  onOverview: (o: Overview) => void;
}) {
  const s = o.study;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">点につながる学習へ</span>
          <h1>今の位置を、確かめる。</h1>
          <p>自力で解く力、時間を空けて思い出す力、実際の得点。</p>
        </div>
      </div>
      <ExamResults
        o={o}
        busy={busy}
        perform={perform}
        onOverview={onOverview}
      />
      <div className="learning-metrics">
        <div>
          <b>
            {s.touched}
            <small> / {s.total}</small>
          </b>
          <span>着手した単元</span>
        </div>
        <div>
          <b>{s.secure}</b>
          <span>定着を確認した単元</span>
        </div>
        <div>
          <b>{s.due}</b>
          <span>復習時期の問題</span>
        </div>
        <div>
          <b>
            {s.week.minutes}
            <small>分</small>
          </b>
          <span>直近7日の学習時間</span>
        </div>
      </div>
      <section className="card unit-progress">
        <div className="section-title">
          <h3>科目と単元の状態</h3>
          <span className="pill subtle">問題数より、できること</span>
        </div>
        <p className="muted">
          正答率は初見・教材やヒントを使わない回答の観測値。問題の選び方によって変わるため、本試験の得点率とは分けて見よう。
        </p>
        {s.bySubject.map((sub) => (
          <details key={sub.subject} className="unit-subject">
            <summary>
              <span className="unit-subject-name">
                {sub.name}
                <small>
                  {sub.touched}/{sub.units}単元に着手 · 定着 {sub.secure}
                </small>
              </span>
              <span>
                {sub.accuracy === null ? "確認前" : `${sub.accuracy}%`}
                <small>自力・初見 {sub.observations}問</small>
              </span>
              <ChevronRight size={18} />
            </summary>
            <div className="unit-list">
              {s.units
                .filter((u) => u.subject === sub.subject)
                .map((u) => (
                  <div key={u.key} className={"unit-row stage-" + u.stage}>
                    <i />
                    <span>
                      <strong>{u.topic}</strong>
                      <small>
                        {u.attempts
                          ? `初見・自力 ${u.correct}/${u.independent} · 期日復習成功 ${u.delayed} · 応用成功 ${u.transfer}`
                          : "基礎から順に確認"}
                      </small>
                    </span>
                    <span className="unit-stage">
                      {u.due ? `復習 ${u.due}問` : stageNames[u.stage]}
                    </span>
                  </div>
                ))}
            </div>
          </details>
        ))}
        <details className="methodology">
          <summary>判定と出題の仕組み</summary>
          <p>{s.methodology}</p>
          <p>
            「定着を確認」は、異なる初見問題で3問以上の自力正解・4問以上の観測、24時間以上を空けた期日復習の成功、別の場面への応用、直近の安定をそろえた状態。期限が来たら復習で再確認する。
          </p>
          <p>
            学習時間は解答画面が前面にある時間の概算。一時停止・別タブの間は止まる。ランクとXPは学習を続けるためのゲーム内指標。
          </p>
          <p>
            <a
              href="https://www.dnc.ac.jp/kyotsu/shiken_jouhou/r9/index.html"
              target="_blank"
              rel="noreferrer"
            >
              大学入試センター：令和9年度の出題方針
            </a>{" "}
            ·{" "}
            <a
              href="https://ies.ed.gov/ncee/wwc/practiceguide/1"
              target="_blank"
              rel="noreferrer"
            >
              学習間隔・例題・想起練習の研究指針
            </a>
          </p>
        </details>
      </section>
    </>
  );
}

function ExamResults({
  o,
  busy,
  perform,
  onOverview,
}: {
  o: Overview;
  busy: boolean;
  perform: Perform;
  onOverview: (o: Overview) => void;
}) {
  const [adding, setAdding] = useState(false),
    [date, setDate] = useState(jstDay(Date.now())),
    [label, setLabel] = useState(""),
    [timed, setTimed] = useState(true),
    [scores, setScores] = useState<Record<string, string>>({}),
    [maxima, setMaxima] = useState<Record<string, string>>({}),
    [id, setId] = useState(() => crypto.randomUUID());
  const records = o.study.records,
    latest = records.filter((r) => r.timed).at(-1) ?? records.at(-1);
  const comparable = latest
    ? records
        .filter(
          (r) =>
            r.timed === latest.timed &&
            JSON.stringify([...r.scope].sort()) ===
              JSON.stringify([...latest.scope].sort()),
        )
        .slice(-8)
    : [];
  const current = latest?.percent;
  async function save() {
    const values = o.subjects
      .filter((s) => scores[s]?.trim())
      .map((subject) => ({
        subject,
        score: Number(scores[subject]),
        maxScore: Number(maxima[subject] || defaultWeight(subject)),
      }));
    if (!values.length)
      throw Error("少なくとも1科目の得点を入力してください。");
    if (
      values.some(
        (s) =>
          !Number.isFinite(s.score) ||
          !Number.isFinite(s.maxScore) ||
          s.score < 0 ||
          s.maxScore <= 0 ||
          s.score > s.maxScore,
      )
    )
      throw Error("得点と満点を確認してください。");
    const record: ExamRecord = {
      id,
      date,
      label: label.trim() || "過去問・実力確認",
      timed,
      scores: values,
    };
    onOverview(await api("/exam-results", record));
    setAdding(false);
    setScores({});
    setLabel("");
    setId(crypto.randomUUID());
  }
  return (
    <section className="card exam-results">
      <div className="section-title">
        <h3>過去問・模試の得点</h3>
        <button className="button outlined" onClick={() => setAdding(!adding)}>
          {adding ? "入力を閉じる" : "得点を記録"}
        </button>
      </div>
      <div className="exam-score-row">
        <div className="exam-score">
          <span>直近の実測</span>
          <strong>
            {current === null || current === undefined ? "—" : current}
            <small>
              {current === null || current === undefined ? "" : "%"}
            </small>
          </strong>
          <p>
            {latest
              ? `${latest.date} · ${latest.label} · ${latest.complete ? "登録科目全て" : "一部科目"}`
              : "週に1回、時間を測って過去問を解いた結果をここへ。"}
          </p>
          <small>
            {latest
              ? `${latest.timed ? "時間を測って解答" : "時間を測らず解答"} · 設定した配点で換算`
              : `目標 ${o.study.goal.targetPercent}% · まず現在地を測ろう。`}
          </small>
        </div>
        {comparable.length >= 2 && (
          <div className="score-trend">
            <svg
              viewBox="0 0 340 100"
              role="img"
              aria-label="同じ科目・計時条件で記録した得点率の推移"
            >
              <line
                x1="10"
                y1={90 - o.study.goal.targetPercent * 0.8}
                x2="330"
                y2={90 - o.study.goal.targetPercent * 0.8}
                stroke="currentColor"
                strokeDasharray="4 5"
                opacity="0.25"
              />
              <polyline
                points={comparable
                  .map(
                    (r, i) =>
                      `${10 + (i * 320) / (comparable.length - 1)},${90 - (r.percent ?? 0) * 0.8}`,
                  )
                  .join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              {comparable.map((r, i) => (
                <circle
                  key={r.id}
                  cx={10 + (i * 320) / (comparable.length - 1)}
                  cy={90 - (r.percent ?? 0) * 0.8}
                  r="4"
                  fill="currentColor"
                >
                  <title>
                    {r.date} {r.percent}%
                  </title>
                </circle>
              ))}
            </svg>
            <small>同じ科目・計時条件の記録。破線は目標。</small>
          </div>
        )}
      </div>
      {adding && (
        <form
          className="exam-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(save);
          }}
        >
          <div className="goal-form-grid">
            <label>
              解いた日
              <input
                type="date"
                required
                min="2000-01-01"
                max={jstDay(Date.now())}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              教材・試験名
              <input
                maxLength={80}
                placeholder="例：2026本試験"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
          </div>
          <div className="exam-input-head">
            <span>科目（解いた科目だけ）</span>
            <span>得点</span>
            <span>満点</span>
          </div>
          {o.subjects.map((s) => (
            <div key={s} className="exam-input-row">
              <span>{subjectName(s)}</span>
              <input
                aria-label={subjectName(s) + "の得点"}
                type="number"
                min={0}
                max={1000}
                step="any"
                value={scores[s] ?? ""}
                placeholder="—"
                onChange={(e) => setScores({ ...scores, [s]: e.target.value })}
              />
              <input
                aria-label={subjectName(s) + "の満点"}
                type="number"
                min={1}
                max={1000}
                step="any"
                value={maxima[s] ?? defaultWeight(s)}
                onChange={(e) => setMaxima({ ...maxima, [s]: e.target.value })}
              />
            </div>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={timed}
              onChange={(e) => setTimed(e.target.checked)}
            />
            制限時間を測り、解説を見ずに解いた
          </label>
          <button className="button primary" type="submit" disabled={busy}>
            得点を保存 <Check size={17} />
          </button>
        </form>
      )}
      {!!records.length && (
        <details className="exam-history">
          <summary>記録を振り返る（{records.length}件）</summary>
          {records
            .slice()
            .reverse()
            .map((r) => (
              <div className="exam-history-row" key={r.id}>
                <div>
                  <strong>{r.label}</strong>
                  <small>
                    {r.date} ·{" "}
                    {r.scores
                      .map(
                        (x) =>
                          `${subjectName(x.subject)} ${x.score}/${x.maxScore}`,
                      )
                      .join(" / ")}
                  </small>
                </div>
                <b>{r.percent === null ? "対象外" : `${r.percent}%`}</b>
                <button
                  className="icon-button"
                  aria-label={r.label + "の記録を削除"}
                  disabled={busy}
                  onClick={() =>
                    void perform(async () =>
                      onOverview(await api("/exam-results", { remove: r.id })),
                    )
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
        </details>
      )}
    </section>
  );
}
