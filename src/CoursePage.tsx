import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Map,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import type { overview, publicInstance } from "../worker/engine";
import type { CourseLesson } from "../worker/course-content";
import { courseKey, courseSteps, type CourseSelection } from "../shared/course";
import { subjects } from "../worker/catalog";
import { api } from "./api";
import { MathText } from "./MathText";
type Overview = ReturnType<typeof overview>;
type Instance = NonNullable<ReturnType<typeof publicInstance>>;
type Perform = (fn: () => Promise<void>) => Promise<void>;
const subjectName = (id: string) =>
  subjects.find((s) => s.id === id)?.name ?? id;

export function CourseTrail({
  steps,
  compact = false,
}: {
  steps: boolean[];
  compact?: boolean;
}) {
  return (
    <ol
      className={"course-trail " + (compact ? "compact" : "")}
      aria-label="この論点の進み具合"
    >
      {courseSteps.map((name, n) => (
        <li key={name} className={steps[n] ? "done" : ""}>
          <span>{steps[n] ? <Check size={14} /> : n + 1}</span>
          <b>{name}</b>
        </li>
      ))}
    </ol>
  );
}

export function CoursePage({
  o,
  busy,
  perform,
  onSaved,
  onPractice,
}: {
  o: Overview;
  busy: boolean;
  perform: Perform;
  onSaved: (r: { overview: Overview; instance?: Instance | null }) => void;
  onPractice: () => Promise<void>;
}) {
  const c = o.course;
  const [selection, setSelection] = useState<CourseSelection | null>(
    c.next ?? c.active,
  );
  const [view, setView] = useState<"next" | "map">("next");
  const [stage, setStage] = useState<"overview" | "read" | "recall">(
    "overview",
  );
  const [lesson, setLesson] = useState<CourseLesson | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{
    correct: boolean;
    answer: string;
    explanation: string;
  } | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  const [subject, setSubject] = useState(selection?.subject ?? o.subjects[0]);
  const feedback = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (result)
      feedback.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
  }, [result]);
  const current =
    c.units
      .flatMap((u) => u.lessons)
      .find((l) => selection && l.key === courseKey(selection)) ?? c.next;
  const unit = c.units.find(
    (u) => u.subject === current?.subject && u.topic === current?.topic,
  );
  const prerequisite =
    o.study.units.find((u) => u.key === unit?.key)?.prerequisites ?? [];
  const all = c.units.flatMap((u) => u.lessons);
  const next =
    current &&
    (all
      .slice(all.findIndex((l) => l.key === current.key) + 1)
      .find((l) => !l.done) ??
      all.find((l) => !l.done && l.key !== current.key));
  function choose(s: CourseSelection) {
    setSelection(s);
    setSubject(s.subject);
    setStage("overview");
    setLesson(null);
    setResult(null);
    setInput("");
    setRequest(null);
    setView("next");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function pin() {
    if (!current) return;
    onSaved(
      await api("/course/route", {
        selection: {
          subject: current.subject,
          topic: current.topic,
          lesson: current.lesson,
        },
      }),
    );
  }
  function openLesson() {
    if (!current) return;
    void perform(async () => {
      await pin();
      const r = await api("/course/lesson", current);
      onSaved(r);
      setLesson(r.lesson);
      setStage("read");
      setResult(null);
    });
  }
  function recall() {
    setStage("recall");
    setResult(null);
    setInput("");
    setRequest(null);
  }
  function practice() {
    void perform(async () => {
      await pin();
      await onPractice();
    });
  }
  if (!current)
    return (
      <section className="card">
        <h1>学習ルート</h1>
        <p>受験科目を選ぶと、教材と確認問題が並びます。</p>
      </section>
    );
  return (
    <div
      className={
        "course-page " +
        (stage !== "overview" && view !== "map" ? "learning-focused" : "")
      }
    >
      <div className="page-heading course-heading">
        <div>
          <span className="eyebrow">BUILD YOUR GROUND</span>
          <h1>知識を、つなげ。</h1>
          <p>ひとつずつ、使える知識に変えていく。</p>
        </div>
        <button
          className="button outlined"
          onClick={() => setView(view === "map" ? "next" : "map")}
        >
          <Map size={17} />
          {view === "map" ? "今の論点に戻る" : "全体の地図"}
        </button>
      </div>
      {stage !== "overview" && view !== "map" && (
        <button
          className="text-button course-focus-back"
          onClick={() => setStage("overview")}
        >
          <ArrowLeft size={16} />
          学習ルートに戻る
        </button>
      )}
      <section className="course-ledger" aria-label="身についた知識の記録">
        <div>
          <b>{c.reproduced}</b>
          <span>記述で再現</span>
        </div>
        <div>
          <b>{c.applied}</b>
          <span>別問で使えた</span>
        </div>
        <div>
          <b>{c.retained}</b>
          <span>後日も確認</span>
        </div>
        <small>教材の範囲 {c.total}論点 · 4択の正解数とは別に記録</small>
      </section>
      {!!c.recallDue && (
        <button
          className="course-recall-due"
          disabled={busy}
          onClick={() => {
            const due = all.find((l) => l.recallReady);
            if (due) {
              choose(due);
              setStage("recall");
            }
          }}
        >
          <RotateCcw size={17} />
          間を空けて確認できる知識が {c.recallDue}論点
          <ArrowRight size={16} />
        </button>
      )}
      {view === "map" ? (
        <section className="card course-map" aria-label="学習の地図">
          <div className="course-subjects" role="group" aria-label="地図の科目">
            {o.subjects.map((id) => (
              <button
                key={id}
                aria-pressed={subject === id}
                onClick={() => setSubject(id)}
              >
                {subjectName(id)}
              </button>
            ))}
          </div>
          <p className="muted">
            上から基礎をつなぐ。どこからでも学べる。緑の印は実際の確認を終えた段階。
          </p>
          <ol className="course-unit-list">
            {c.units
              .filter((u) => u.subject === subject)
              .map((u, n) => (
                <li key={u.key}>
                  <div className="course-unit-number">
                    {String(n + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <h2>{u.topic}</h2>
                    {u.lessons.map((l) => (
                      <button
                        key={l.key}
                        className={
                          "course-node " +
                          (current.key === l.key ? "current" : "")
                        }
                        onClick={() => choose(l)}
                      >
                        <span>
                          <strong>{l.title}</strong>
                          <small>
                            {l.done
                              ? "後日も確認できた"
                              : l.stage === 0
                                ? "教材から理解する"
                                : l.stage === 1
                                  ? "次は記述で再現"
                                  : l.stage === 2
                                    ? `別問で確認 ${Math.min(2, l.proof)}/2 · 応用 ${Math.min(1, l.transfer)}/1`
                                    : "翌日以降に再確認"}
                          </small>
                        </span>
                        <span
                          className="course-node-marks"
                          aria-label={`${l.steps.filter(Boolean).length}/4段階`}
                        >
                          {l.steps.map((v, i) => (
                            <i key={i} className={v ? "done" : ""} />
                          ))}
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                </li>
              ))}
          </ol>
        </section>
      ) : (
        <>
          <div className="course-breadcrumb">
            <span>{subjectName(current.subject)}</span>
            <ChevronRight size={14} />
            <span>{current.topic}</span>
          </div>
          <section
            className="card course-focus"
            aria-label="今回身につける知識"
          >
            <span className="eyebrow">CURRENT CHAPTER</span>
            <h2>{current.title}</h2>
            <CourseTrail steps={current.steps} />
            {stage === "overview" && (
              <>
                <div className="course-next-action">
                  <span className="course-next-icon">
                    {current.recallReady ? (
                      <RotateCcw />
                    ) : current.reproduced ? (
                      <Target />
                    ) : (
                      <BookOpen />
                    )}
                  </span>
                  <div>
                    <h3>
                      {current.recallReady
                        ? "間を空けた今、思い出せるか。"
                        : current.steps[2]
                          ? "この論点は、別問でも使えた。"
                          : current.reproduced
                            ? "次は、別の問題で使ってみる。"
                            : current.read
                              ? "教材を閉じて、再現してみる。"
                              : "最初に、知識と例をつかむ。"}
                    </h3>
                    <p>
                      {current.steps[2]
                        ? `選択肢を見る前に考えを残した初見正解 ${current.proof}問 · 応用 ${current.transfer}問。次は翌日以降に確かめる。`
                        : current.reproduced
                          ? "記述チェックを通過。初見の別問2問と、そのうち1問の応用で確かめる。"
                          : "短い教材を読んだら、選択肢なしの問いで確認する。"}
                    </p>
                  </div>
                </div>
                <button
                  className="button primary course-primary"
                  disabled={busy}
                  onClick={
                    current.recallReady
                      ? recall
                      : current.steps[2] && next
                        ? () => choose(next)
                        : current.reproduced
                          ? practice
                          : current.read
                            ? recall
                            : openLesson
                  }
                >
                  {current.recallReady
                    ? "教材なしで再確認"
                    : current.steps[2] && next
                      ? "次の論点に進む"
                      : current.reproduced
                        ? "別問で使ってみる"
                        : current.read
                          ? "記述チェックを開く"
                          : "教材から始める"}
                  <ArrowRight size={18} />
                </button>
                <div className="course-secondary-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={openLesson}
                  >
                    {current.read ? "教材を読み直す" : "教材を開く"}
                  </button>
                  {current.read && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={recall}
                    >
                      記述で確認する
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={practice}
                  >
                    演習に取り組む
                  </button>
                </div>
                {current.steps[2] &&
                  !current.recallReady &&
                  current.dueAt &&
                  !current.delayed && (
                    <p className="course-wait-note">
                      次の記述確認の目安：
                      {new Date(current.dueAt).toLocaleString("ja-JP")}
                      。今ここで繰り返しても「後日」の段階には進まない。
                    </p>
                  )}
                {!!prerequisite.length && (
                  <details className="course-connections">
                    <summary>この単元の土台</summary>
                    {prerequisite.map((key) => {
                      const p = c.units.find((u) => u.key === key);
                      return (
                        p && (
                          <button
                            className="text-button"
                            key={key}
                            onClick={() => choose(p.lessons[0])}
                          >
                            <ArrowLeft size={14} />
                            {subjectName(p.subject)} · {p.topic}
                          </button>
                        )
                      );
                    })}
                  </details>
                )}
              </>
            )}
            {stage === "read" && lesson && (
              <div className="course-reading">
                <h3>知っておくこと</h3>
                <p>
                  <MathText text={lesson.knowledge} />
                </p>
                <h3>使い方</h3>
                <p>
                  <MathText text={lesson.method} />
                </p>
                {lesson.example && (
                  <section className="worked-example">
                    <span className="eyebrow">ONE WORKED EXAMPLE</span>
                    <h4>
                      <MathText text={lesson.example.problem} />
                    </h4>
                    <ol>
                      {lesson.example.steps.map((step, n) => (
                        <li key={n}>
                          <MathText text={step} />
                        </li>
                      ))}
                    </ol>
                    <p className="worked-example-conclusion">
                      <MathText text={lesson.example.conclusion} />
                    </p>
                  </section>
                )}
                <button
                  className="button primary course-primary"
                  disabled={busy}
                  onClick={recall}
                >
                  教材を閉じて、書いてみる
                  <ArrowRight size={18} />
                </button>
                <p className="field-note">
                  読んだ段階を記録した。理解や定着の確認は、ここから。
                </p>
              </div>
            )}
            {stage === "recall" && (
              <div className="course-recall">
                <span className="pill subtle">選択肢なし · ひとつ再現する</span>
                <h3>
                  <MathText text={current.prompt} />
                </h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (result || !input.trim()) return;
                    const requestId = request ?? crypto.randomUUID();
                    setRequest(requestId);
                    void perform(async () => {
                      const r = await api("/course/check", {
                        ...current,
                        input,
                        requestId,
                      });
                      setResult(r.result);
                      onSaved(r);
                    });
                  }}
                >
                  <label>
                    自分の答え
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      maxLength={1000}
                      disabled={busy || !!result}
                      autoComplete="off"
                      autoFocus
                    />
                  </label>
                  {!result && (
                    <button
                      className="button primary course-primary"
                      type="submit"
                      disabled={busy || !input.trim()}
                    >
                      答えを確かめる
                      <Check size={18} />
                    </button>
                  )}
                </form>
                {result && (
                  <div
                    ref={feedback}
                    className={
                      "course-check-result " +
                      (result.correct ? "correct" : "retry")
                    }
                    role="status"
                  >
                    <h3>
                      {result.correct ? (
                        <Check size={21} />
                      ) : (
                        <RotateCcw size={21} />
                      )}
                      {result.correct
                        ? "選択肢なしで、再現できた。"
                        : "ここを覚え直そう。"}
                    </h3>
                    <p>
                      <strong>
                        答え：
                        <MathText text={result.answer} />
                      </strong>
                    </p>
                    <p>
                      <MathText text={result.explanation} />
                    </p>
                    <small>
                      {result.correct
                        ? "この短い問いでの確認。単元全体の理解とは分けて記録する。"
                        : "この問いは短い表記で照合。意味が合っていても表記差で不一致になることがある。"}
                    </small>
                    <button
                      className="button primary course-primary"
                      disabled={busy}
                      onClick={result.correct ? practice : recall}
                    >
                      {result.correct
                        ? "この知識で、別問に挑む"
                        : "答えを閉じて、もう一度書く"}
                      <ArrowRight size={18} />
                    </button>
                  </div>
                )}
                <div className="course-secondary-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={openLesson}
                  >
                    教材に戻る
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setStage("overview")}
                  >
                    進み具合に戻る
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
      <details className="course-method">
        <summary>何を「進んだ」と数えるか</summary>
        <p>
          教材を開く → 短い記述に正答 →
          選択肢を見る前に考えを残し、異なる初見問題で2問正解（うち応用1問） →
          24時間以上空けて記述または期日復習に成功、の4段階。ヒント・勘の申告・問題の報告がある回答は別問の証拠に使わない。
        </p>
        <p>
          演習前の記述内容は自動採点していないため、演習での自力判断には自己申告を含む。教材は各単元の基礎の道筋で、全知識の網羅や本試験の得点保証ではない。以前の4択記録は「成績」に残る。
        </p>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              onSaved(await api("/course/route", { selection: null }));
              await onPractice();
            })
          }
        >
          全科目を混ぜた演習に切り替える
          <ArrowRight size={15} />
        </button>
      </details>
    </div>
  );
}

export function RecallGate({
  instance,
  busy,
  perform,
  onInstance,
}: {
  instance: Instance;
  busy: boolean;
  perform: Perform;
  onInstance: (i: Instance) => void;
}) {
  const [text, setText] = useState(instance.recallDraft ?? "");
  if (instance.answered) return null;
  if (instance.responseMode)
    return (
      <div className="recall-committed">
        <Check size={15} />
        <span>
          {instance.responseMode === "recall"
            ? "先に考えた答え・根拠を記録した。4択で確かめよう。"
            : "選択肢を使った練習。別問の自力確認とは分けて記録。"}
        </span>
        {instance.recallDraft && (
          <details>
            <summary>自分の考え</summary>
            <p>{instance.recallDraft}</p>
          </details>
        )}
      </div>
    );
  const commit = (mode: "recall" | "recognition") =>
    void perform(async () => {
      const r = await api("/recall", {
        instanceId: instance.id,
        mode,
        input: mode === "recall" ? text.trim() : "",
      });
      onInstance(r.instance);
    });
  return (
    <section className="recall-gate" aria-label="選択肢を見る前の確認">
      <span className="eyebrow">THINK FIRST</span>
      <h3>答えや根拠を、先に出してみる。</h3>
      <p>
        数値、用語、読み取った条件。短くていい。わからなければ、選択肢を開いて学べる。
      </p>
      <label>
        選択肢を見る前の考え
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder="自分の答え・使う知識・根拠など"
          disabled={busy}
        />
      </label>
      <button
        className="button primary"
        disabled={busy || !text.trim()}
        onClick={() => commit("recall")}
      >
        考えを残して、4択で確認
        <ArrowRight size={17} />
      </button>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => commit("recognition")}
      >
        選択肢を見て考える
      </button>
    </section>
  );
}
