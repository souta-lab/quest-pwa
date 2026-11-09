import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Flame,
  Gift,
  Home,
  Layers,
  Lightbulb,
  LogOut,
  Pause,
  Play,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
  PenLine,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { api, streamApi, ApiError } from "./api";
import { MathText } from "./MathText";
import { StudyContent } from "./StudyContent";
import { Notebook } from "./Notebook";
import { DesignNotes } from "./DesignNotes";
import { RewardEffects, type Reward } from "./RewardEffects";
import { APP_VERSION } from "../shared/release";
import {
  beginSession,
  goalKey,
  isGoal,
  recordAnswer,
  restoreSession,
  sessionKey,
  sessionProgress,
  type Goal,
  type StudySession,
} from "./study-session";
import {
  GenerationSettings,
  type GenerationStatus,
} from "./GenerationSettings";
import { subjects } from "../worker/catalog";
import type { overview, publicInstance } from "../worker/engine";
import "katex/dist/katex.min.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";
import "@fontsource/noto-sans-jp/900.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "./style.css";
import "./interaction.css";
import "./study.css";
import "./ignition.css";
import "./rebellion.css";
import "./course.css";
import "./family.css";
import { CoursePage, CourseTrail, RecallGate } from "./CoursePage";
import {
  StudyHome,
  LearningProgress,
  GoalSettings,
  FoundationPanel,
  Reflection,
} from "./StudyDashboard";
import { useStudyClock } from "./useStudyClock";
import { practiceNames } from "../shared/study";
type Overview = ReturnType<typeof overview>;
type Instance = NonNullable<ReturnType<typeof publicInstance>>;
type Me = {
  user: { id: string; name: string; email: string };
  overview: Overview;
  instance: Instance | null;
};
type Page =
  | "home"
  | "course"
  | "quiz"
  | "stats"
  | "items"
  | "ranking"
  | "settings"
  | "summary";
type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  incomplete?: boolean;
};
const presetScience = [
  "japanese",
  "math1",
  "math2",
  "english",
  "information",
  "biology",
  "politics",
];
const presetArts = [
  "japanese",
  "math1",
  "math2",
  "english",
  "information",
  "basicScience",
  "japanHistory",
  "politics",
];
const icons = {
  home: Home,
  course: Layers,
  quiz: BookOpen,
  stats: ChartNoAxesCombined,
  items: Gift,
  ranking: Trophy,
  settings: Settings,
};
const navItems = [
  ["home", "ホーム"],
  ["course", "学習ルート"],
  ["stats", "成績"],
  ["items", "アイテム"],
  ["ranking", "ランキング"],
  ["settings", "設定"],
] as const;
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState<Page>("home"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [reward, setReward] = useState<Reward | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [instance, setInstance] = useState<Instance | null>(null),
    [waiting, setWaiting] = useState(false),
    [preparedNext, setPreparedNext] = useState<{
      previousId: string;
      instance: Instance;
    } | null>(null),
    [preparationError, setPreparationError] = useState(""),
    [reportReason, setReportReason] = useState("問題・正解に誤りがある"),
    [generation, setGeneration] = useState<GenerationStatus | null>(null),
    [providerVersion, setProviderVersion] = useState(0),
    [explain, setExplain] = useState(false),
    [notes, setNotes] = useState(false),
    [hintOpen, setHintOpen] = useState(false),
    [hintStage, setHintStage] = useState(1),
    [hintText, setHintText] = useState(""),
    [hintAiText, setHintAiText] = useState(""),
    [hintLoading, setHintLoading] = useState(false),
    [hintError, setHintError] = useState(""),
    [hintInput, setHintInput] = useState(""),
    [hintChat, setHintChat] = useState<ChatTurn[]>([]),
    [hintChatLoading, setHintChatLoading] = useState(false),
    [hintReply, setHintReply] = useState(""),
    [hintChatStatus, setHintChatStatus] = useState(""),
    [paused, setPaused] = useState(false),
    [ranking, setRanking] = useState<any>(null),
    [studyGoal, setStudyGoal] = useState<Goal>(3),
    [studySession, setStudySession] = useState<StudySession | null>(null);
  const [loginMode, setLoginMode] = useState<"login" | "register" | "reset">(
      "login",
    ),
    [devLink, setDevLink] = useState(""),
    [authMessage, setAuthMessage] = useState(
      new URLSearchParams(location.search).has("verified")
        ? "メールを確認しました。ログインしてください。"
        : "",
    ),
    [catalog, setCatalog] = useState({ googleConfigured: false, bankCount: 0 });
  const readActiveMs = useStudyClock(
    instance?.id,
    page === "quiz" && !!instance && !instance.answered && !paused && !waiting,
  );
  const hintRequests = useRef(new Map<string, Promise<void>>()),
    pendingHintChat = useRef<{
      key: string;
      message: string;
      id: string;
      history: { role: "user" | "assistant"; content: string }[];
      failed: boolean;
    } | null>(null),
    chatAbort = useRef<AbortController | null>(null),
    chatEnd = useRef<HTMLDivElement | null>(null),
    chatInput = useRef<HTMLTextAreaElement | null>(null),
    hintView = useRef(""),
    lease = useRef(crypto.randomUUID()),
    lastAction = useRef(Date.now()),
    audio = useRef<AudioContext | null>(null);
  const studyRef = useRef<StudySession | null>(null),
    questionRef = useRef<HTMLDivElement | null>(null),
    nextButtonRef = useRef<HTMLButtonElement | null>(null);
  function saveStudy(s: StudySession | null) {
    studyRef.current = s;
    setStudySession(s);
    if (s)
      try {
        sessionStorage.setItem(sessionKey(s.userId), JSON.stringify(s));
      } catch {}
  }
  function chooseGoal(goal: Goal) {
    setStudyGoal(goal);
    if (me)
      try {
        localStorage.setItem(goalKey(me.user.id), String(goal));
      } catch {}
  }
  function finishStudy() {
    if (studyRef.current) saveStudy({ ...studyRef.current, active: false });
    setPaused(false);
    setPage("summary");
  }
  useEffect(() => {
    const id = me?.user.id;
    if (!id) {
      saveStudy(null);
      setStudyGoal(3);
      return;
    }
    let goal: unknown = 3,
      session: StudySession | null = null;
    try {
      goal = Number(localStorage.getItem(goalKey(id)));
      session = restoreSession(sessionStorage.getItem(sessionKey(id)), id);
    } catch {}
    setStudyGoal(isGoal(goal) ? goal : 3);
    saveStudy(session);
  }, [me?.user.id]);
  useEffect(() => {
    const a = instance?.answered,
      s = studyRef.current;
    if (a && s && s.userId === me?.user.id && s.active)
      saveStudy(recordAnswer(s, a));
  }, [instance?.answered?.id, instance?.answered?.forgot, me?.user.id]);
  useEffect(
    () => () => {
      chatAbort.current?.abort();
    },
    [instance?.id, !!instance?.answered],
  );
  useEffect(() => {
    if (page === "quiz" && instance && !instance.answered)
      questionRef.current?.focus({ preventScroll: true });
  }, [page, instance?.id]);
  useEffect(() => {
    if (page === "quiz" && instance?.answered && !hintOpen)
      nextButtonRef.current?.focus({ preventScroll: false });
  }, [page, instance?.answered?.id]);
  useEffect(() => {
    if (!hintOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>(".hint-panel");
    panel?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setHintOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const targets = [
        ...panel.querySelectorAll<HTMLElement>(
          "button:not(:disabled),textarea:not(:disabled),input:not(:disabled),a[href]",
        ),
      ].filter((el) => el.getClientRects().length);
      const first = targets[0],
        last = targets.at(-1);
      if (!first) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || document.activeElement === panel)
      ) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus({ preventScroll: true });
    };
  }, [hintOpen]);
  const resetToken = new URLSearchParams(location.search).get("reset");
  async function reload() {
    try {
      const data = await api<Me>("/me");
      setMe(data);
      setInstance(data.instance);
      return data;
    } catch (e) {
      if ((e as Error).message === "ログインしてください。") setMe(null);
      else setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void reload();
    api("/catalog")
      .then(setCatalog)
      .catch(() => {});
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    const action = () => {
      lastAction.current = Date.now();
    };
    window.addEventListener("pointerdown", action);
    window.addEventListener("keydown", action);
    return () => {
      window.removeEventListener("pointerdown", action);
      window.removeEventListener("keydown", action);
    };
  }, []);
  useEffect(() => {
    if (!me || me.overview.boostRemaining <= 0) return;
    const tick = () => {
      const active =
        page === "quiz" &&
        !!instance &&
        !instance.answered &&
        !paused &&
        document.visibilityState === "visible" &&
        Date.now() - lastAction.current < 90000;
      api("/heartbeat", { lease: lease.current, active })
        .then((r) =>
          setMe((m) =>
            m
              ? {
                  ...m,
                  overview: { ...m.overview, boostRemaining: r.remaining },
                }
              : m,
          ),
        )
        .catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 5000);
    const hide = () => {
      if (document.hidden)
        void fetch("/api/heartbeat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lease: lease.current, active: false }),
          keepalive: true,
        });
      else tick();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [
    page,
    instance?.id,
    !!instance?.answered,
    paused,
    !!me,
    !!me?.overview.boostRemaining,
  ]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  function sound(win = true) {
    if (!me?.overview.settings.sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      (win ? [0, 0.1, 0.2] : [0]).forEach((delay, i) => {
        const o = audio.current!.createOscillator(),
          g = audio.current!.createGain();
        o.type = "sine";
        o.frequency.value = win ? [523, 659, 784][i] : 440;
        g.gain.setValueAtTime(0.07, audio.current!.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(
          0.001,
          audio.current!.currentTime + delay + 0.15,
        );
        o.connect(g);
        g.connect(audio.current!.destination);
        o.start(audio.current!.currentTime + delay);
        o.stop(audio.current!.currentTime + delay + 0.17);
      });
    } catch {}
  }
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function receiveNext(data: any) {
    if (data.waiting) {
      setInstance(null);
      setWaiting(true);
      setGeneration((g) => (g ? { ...g, plan: data.plan } : g));
    } else {
      setInstance(data);
      setWaiting(false);
      setExplain(
        !!data.answered && (!data.answered.correct || data.answered.hint),
      );
    }
  }
  useEffect(() => {
    if (page !== "quiz" || !instance || paused || busy) return;
    let cancelled = false,
      running = false;
    const previousId = instance.id;
    setPreparationError("");
    const prepare = async () => {
      if (cancelled || running || document.hidden) return;
      running = true;
      try {
        const data = await api<any>("/next/prepare", {});
        if (cancelled) return;
        if (data.waiting) {
          const g = await api<GenerationStatus>("/generation");
          if (!cancelled) {
            setGeneration(g);
            if (g.plan?.state === "failed") clearInterval(timer);
          }
        } else if (data) {
          setPreparedNext({ previousId, instance: data });
          if (me?.overview.generationMode) {
            const g = await api<GenerationStatus>("/generation");
            if (!cancelled) {
              setGeneration(g);
              if (
                !g.buffer ||
                g.buffer.ready >= g.buffer.target ||
                g.buffer.failed
              )
                clearInterval(timer);
            }
          } else clearInterval(timer);
        }
      } catch {
        if (!cancelled) {
          setPreparationError("次の問題は進むときに準備します");
          clearInterval(timer);
        }
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => void prepare(), 2500);
    void prepare();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [page, instance?.id, paused, busy, me?.overview.generationMode]);
  useEffect(() => {
    if (
      !me?.overview.generationMode ||
      page !== "quiz" ||
      !waiting ||
      generation?.plan?.state === "failed"
    )
      return;
    let cancelled = false,
      running = false;
    const poll = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const g = await api<GenerationStatus>("/generation");
        if (cancelled) return;
        if (waiting && (!g.plan || g.plan.state === "ready")) {
          const data = await api("/next", { advance: true });
          if (!cancelled) {
            receiveNext(data);
            setGeneration(g);
            lastAction.current = Date.now();
          }
        } else setGeneration(g);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    page,
    waiting,
    generation?.plan?.state,
    generation?.plan?.id,
    me?.overview.generationMode,
  ]);
  async function storedQuestions() {
    await perform(async () => {
      const g = generation ?? (await api<GenerationStatus>("/generation"));
      await api("/generation/config", {
        enabled: false,
        dailyLimit: null,
        verificationModel: g.verificationModel,
      });
      await reload();
      setGeneration(null);
      receiveNext(await api("/next", { advance: true }));
      setToast("保存済み問題に切り替えました。");
    });
  }
  async function beginQuiz(forceAdvance = false) {
    setReward(null);
    setPreparedNext(null);
    const data = await api<Instance>("/next", {
      advance:
        forceAdvance || (!!instance?.answered && !studyRef.current?.active),
    });
    receiveNext(data);
    setHintText("");
    setHintAiText("");
    setHintLoading(false);
    setHintError("");
    hintRequests.current.clear();
    setPage("quiz");
    setPaused(false);
    lastAction.current = Date.now();
    const existing = studyRef.current;
    if (!existing?.active || existing.userId !== me!.user.id)
      saveStudy(beginSession(me!.user.id, studyGoal));
    else if (existing.goal !== studyGoal)
      saveStudy({
        ...existing,
        goal: studyGoal,
        checkpointStart: existing.answers.length,
      });
  }
  async function start() {
    await perform(beginQuiz);
  }
  function courseSaved(r: { overview: Overview; instance?: Instance | null }) {
    setMe((m) => (m ? { ...m, overview: r.overview } : m));
    if ("instance" in r) {
      setInstance(r.instance ?? null);
      setPreparedNext(null);
      setWaiting(false);
      setGeneration((g) => (g ? { ...g, plan: null } : g));
    }
  }
  async function enableGenerationAndStart() {
    await perform(async () => {
      const [p, g] = await Promise.all([
        api("/provider"),
        api<GenerationStatus>("/generation"),
      ]);
      if (!p.config) {
        setPage("settings");
        setToast("APIキーを保存すると新問を生成できます。");
        return;
      }
      const updated = await api<GenerationStatus>("/generation/config", {
        enabled: true,
        verificationModel: g.verificationModel || p.config.model,
      });
      setGeneration(updated);
      await reload();
      await beginQuiz();
    });
  }
  async function submit(option: string | null) {
    if (
      !instance ||
      instance.answered ||
      paused ||
      (option !== null && !instance.responseMode)
    )
      return;
    await perform(async () => {
      const data = await api("/answer", {
        instanceId: instance.id,
        option,
        activeMs: readActiveMs(),
      });
      setInstance((i) => (i ? { ...i, answered: data.result } : i));
      let goal = false;
      if (studyRef.current?.userId === me!.user.id) {
        const before = studyRef.current,
          after = recordAnswer(before, data.result);
        goal =
          !sessionProgress(before).reached && sessionProgress(after).reached;
        saveStudy(after);
      }
      const level =
        data.overview.level > me!.overview.level ? data.overview.level : null;
      setReward({
        id: data.result.id,
        xp: data.result.xp,
        correct: data.result.correct,
        combo: data.result.combo,
        level,
        drop: data.result.drop,
        goal,
      });
      setMe((m) => (m ? { ...m, overview: data.overview } : m));
      setExplain(!data.result.correct || data.result.hint || option === null);
      sound(data.result.correct);
      if (data.result.drop || level)
        setToast(
          [
            level ? `LEVEL UP! Lv.${level}` : "",
            data.result.drop ? "レアドロップ！ XPブーストを獲得" : "",
          ]
            .filter(Boolean)
            .join(" · "),
        );
    });
  }
  async function advance() {
    await perform(async () => {
      const previous = instance;
      const cached =
        preparedNext && preparedNext.previousId === previous?.id
          ? preparedNext.instance
          : null;
      setPreparedNext(null);
      if (cached) receiveNext(cached);
      try {
        let data;
        try {
          data = await api<Instance>(
            "/next",
            cached
              ? {
                  advance: true,
                  preparedId: cached.id,
                  previousId: previous!.id,
                }
              : { advance: true },
          );
        } catch (e) {
          if (!cached) throw e;
          data = await api<Instance>("/next", { advance: true });
        }
        receiveNext(data);
        const s = studyRef.current;
        if (s && sessionProgress(s).reached)
          saveStudy({ ...s, checkpointStart: s.answers.length });
      } catch (e) {
        await reload();
        throw e;
      }
      window.scrollTo({ top: 0, behavior: "instant" });
      setExplain(false);
      setHintText("");
      setHintAiText("");
      setHintError("");
      setHintLoading(false);
      hintRequests.current.clear();
      setHintOpen(false);
      setReward(null);
      setPaused(false);
      lastAction.current = Date.now();
    });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        page !== "quiz" ||
        (e.target as HTMLElement).closest("input,textarea,button") ||
        busy ||
        hintOpen
      )
        return;
      if (
        ["1", "2", "3", "4"].includes(e.key) &&
        instance &&
        !instance.answered
      ) {
        e.preventDefault();
        void submit(instance!.question.options[Number(e.key) - 1].id);
      } else if ((e.key === "Enter" || e.key === " ") && instance?.answered) {
        e.preventDefault();
        nextButtonRef.current?.click();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [page, instance, busy, hintOpen, paused]);
  hintView.current = instance ? `${instance.id}:${!!instance.answered}` : "";
  async function openHint(retry = false) {
    if (!instance) return;
    setHintOpen(true);
    if (retry && hintLoading) return;
    const target = instance;
    const key = `${target.id}:${!!target.answered}`;
    if (hintRequests.current.has(key) && !retry) return;
    if (!retry) {
      setHintStage(1);
      setHintChat([]);
      setHintChatLoading(false);
      setHintReply("");
      setHintChatStatus("");
      pendingHintChat.current = null;
      setHintInput("");
      setHintText("");
      setHintAiText("");
    }
    setHintError("");
    setHintLoading(true);
    const current = () => hintView.current === key;
    const request = (async () => {
      try {
        const prepared = await api("/hint", {
          instanceId: target.id,
          message: "最初の着眼点を教えて",
          ai: false,
        });
        if (!current()) return;
        setHintText(prepared.text);
        setInstance((i) =>
          i?.id === target.id ? { ...i, hint: i.answered ? i.hint : true } : i,
        );
        const provider = await api("/provider");
        if (!current() || !provider.config) return;
        const result = await api("/hint", {
          instanceId: target.id,
          message: "答えを明かさず、考え方のヒントを選んでください。",
          ai: true,
          ...(retry ? { requestId: crypto.randomUUID() } : {}),
        });
        if (current())
          setHintAiText(result.text === prepared.text ? "" : result.text);
      } catch (e) {
        if (current()) setHintError((e as Error).message);
      } finally {
        if (current()) setHintLoading(false);
      }
    })();
    hintRequests.current.set(key, request);
    if (hintRequests.current.size > 4)
      hintRequests.current.delete(hintRequests.current.keys().next().value!);
    await request;
  }
  async function sendHintQuestion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !instance ||
      hintStage !== 3 ||
      hintChatLoading ||
      hintLoading ||
      !hintInput.trim()
    )
      return;
    const target = instance,
      key = `${target.id}:${!!target.answered}`,
      message = hintInput.trim();
    const reused =
      pendingHintChat.current?.key === key &&
      pendingHintChat.current.message === message;
    if (!reused)
      pendingHintChat.current = {
        key,
        message,
        id: crypto.randomUUID(),
        failed: false,
        history: [
          {
            role: "assistant",
            content: (hintAiText || hintText).slice(0, 4000),
          },
          ...hintChat
            .filter((turn) => !turn.incomplete)
            .slice(-8)
            .map(({ role, content }) => ({ role, content })),
        ],
      };
    else if (pendingHintChat.current!.failed) {
      pendingHintChat.current!.id = crypto.randomUUID();
      pendingHintChat.current!.failed = false;
    }
    const pending = pendingHintChat.current!;
    if (!reused)
      setHintChat((turns) => [...turns, { role: "user", content: message }]);
    setHintInput("");
    setHintReply("");
    setHintChatStatus("問題と質問を読んでいます…");
    setHintChatLoading(true);
    setHintError("");
    const controller = new AbortController();
    chatAbort.current = controller;
    let partial = "";
    const current = () => hintView.current === key;
    requestAnimationFrame(() =>
      chatEnd.current?.scrollIntoView({ block: "nearest" }),
    );
    try {
      const result = await streamApi(
        "/hint",
        {
          instanceId: target.id,
          message,
          ai: true,
          chat: true,
          stream: true,
          requestId: pending.id,
          stage: 3,
          history: pending.history,
        },
        {
          delta(text) {
            partial += text;
            if (current()) {
              const panel = chatEnd.current?.closest(".hint-panel");
              const follow =
                panel &&
                panel.scrollHeight - panel.scrollTop - panel.clientHeight < 100;
              setHintReply(partial);
              if (follow)
                requestAnimationFrame(() =>
                  chatEnd.current?.scrollIntoView({ block: "nearest" }),
                );
            }
          },
          status(stage) {
            if (current())
              setHintChatStatus(
                stage === "checking"
                  ? "説明を確認しています…"
                  : stage === "writing"
                    ? "質問への返信を作っています…"
                    : "問題と質問を読んでいます…",
              );
          },
        },
        controller.signal,
      );
      if (!current()) return;
      setHintChat((c) => [...c, { role: "assistant", content: result }]);
      setHintReply("");
      pendingHintChat.current = null;
    } catch (e) {
      if (current()) {
        if (partial)
          setHintChat((c) => [
            ...c,
            { role: "assistant", content: partial, incomplete: true },
          ]);
        setHintReply("");
        const cancelled = controller.signal.aborted;
        if (cancelled || (e instanceof ApiError && e.status !== 409))
          pending.failed = true;
        setHintError(
          cancelled
            ? "返信を停止しました。同じ質問をもう一度送信できます。"
            : (e as Error).message,
        );
        setHintInput((value) => value || message);
      }
    } finally {
      if (current()) {
        setHintChatLoading(false);
        setHintChatStatus("");
      }
      if (chatAbort.current === controller) chatAbort.current = null;
    }
  }
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await perform(async () => {
      setAuthMessage("");
      setDevLink("");
      if (resetToken) {
        await api("/auth/reset", {
          token: resetToken,
          password: f.get("password"),
        });
        history.replaceState({}, "", "/");
        setAuthMessage("パスワードを更新しました。ログインしてください。");
        return;
      }
      if (loginMode === "reset") {
        const r = await api("/auth/reset-request", { email: f.get("email") });
        setAuthMessage(r.message);
        setDevLink(r.devLink ?? "");
        return;
      }
      const r = await api("/auth/" + loginMode, {
        email: f.get("email"),
        password: f.get("password"),
        name: f.get("name") ?? undefined,
      });
      if (loginMode === "register") {
        setAuthMessage(r.message);
        setDevLink(r.devLink ?? "");
      } else await reload();
    });
  }
  async function logout() {
    await perform(async () => {
      await api("/auth/logout", {});
      setMe(null);
      setInstance(null);
      setPage("home");
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith("quest-note:"))
          .forEach((k) => localStorage.removeItem(k));
      } catch {}
    });
  }
  if (!ready)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Layers />
        </div>
        <h1>QUEST</h1>
        <LoaderCircle className="spin" />
        <p>学習データを読み込んでいます</p>
        {error && <p>{error}</p>}
      </div>
    );
  if (!me)
    return (
      <div className="auth-layout">
        <div className="auth-story">
          <a className="brand" href="/">
            <span className="brand-mark">
              <Layers size={23} />
            </span>
            QUEST
          </a>
          <div>
            <span className="eyebrow">NO ONE GETS THE FINAL WORD.</span>
            <h1>
              その「無理」を、
              <br />
              <em>撤回させろ。</em>
            </h1>
            <p>
              見返すための一手は、自分の中に積み上がる。
              <br />
              知らなかったことを、自力で取れる1点へ。
            </p>
            <div className="orbit">
              <div className="orbit-center">
                <Sparkles size={42} />
              </div>
              <span className="orbit-chip c1">
                数 <small>二次関数</small>
              </span>
              <span className="orbit-chip c2">
                英 <small>Reading</small>
              </span>
              <span className="orbit-chip c3">
                生 <small>遺伝情報</small>
              </span>
              <span className="orbit-spark">✦</span>
            </div>
          </div>
          <small>QUEST / 共通テストを、攻略する。</small>
        </div>
        <main className="auth-form">
          <div className="auth-card">
            <span className="pill">THE COMEBACK IS YOURS</span>
            <h2>
              {resetToken
                ? "新しいパスワード"
                : loginMode === "register"
                  ? "QUESTへようこそ"
                  : loginMode === "reset"
                    ? "パスワードを再設定"
                    : "おかえりなさい。"}
            </h2>
            <p className="muted">
              {loginMode === "register"
                ? "アカウントを作って、受験科目を選ぼう。"
                : "次の1問が待っている。続きを、取りにいこう。"}
            </p>
            {!resetToken && loginMode !== "reset" && (
              <>
                <button
                  className="google-button"
                  disabled={!catalog.googleConfigured}
                  onClick={() => location.assign("/api/auth/google")}
                >
                  <span className="google-g">G</span> Googleで続ける
                </button>
                {!catalog.googleConfigured && (
                  <small className="muted">
                    Googleログインは接続設定後に利用できます
                  </small>
                )}
                <div className="divider">またはメールで</div>
              </>
            )}
            <form onSubmit={login}>
              {loginMode === "register" && (
                <label>
                  表示名
                  <input
                    name="name"
                    required
                    maxLength={40}
                    autoComplete="nickname"
                    placeholder="あなたの名前"
                  />
                </label>
              )}
              {!resetToken && (
                <label>
                  メールアドレス
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>
              )}
              {(resetToken || loginMode !== "reset") && (
                <label>
                  パスワード
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete={
                      loginMode === "login"
                        ? "current-password"
                        : "new-password"
                    }
                    placeholder="10文字以上"
                  />
                </label>
              )}
              <button className="button primary wide" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={19} />
                ) : (
                  <>
                    {resetToken
                      ? "更新する"
                      : loginMode === "register"
                        ? "アカウントを作成"
                        : loginMode === "reset"
                          ? "再設定メールを送る"
                          : "ログイン"}
                    <ArrowRight size={19} />
                  </>
                )}
              </button>
            </form>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {authMessage && <div className="notice">{authMessage}</div>}
            {devLink && (
              <a className="dev-link" href={devLink}>
                開発環境用：確認リンクを開く <ArrowUpRight size={15} />
              </a>
            )}
            <div className="auth-links">
              <button
                onClick={() => {
                  setLoginMode(loginMode === "register" ? "login" : "register");
                  setError("");
                  setAuthMessage("");
                  setDevLink("");
                }}
              >
                {loginMode === "register"
                  ? "アカウントをお持ちの方"
                  : "はじめての方：新規登録"}
              </button>
              <button onClick={() => setLoginMode("reset")}>
                パスワードを忘れた
              </button>
            </div>
            <p className="privacy-note">
              <ShieldCheck size={16} /> 学習履歴はアカウントに保存されます
            </p>
          </div>
        </main>
      </div>
    );
  const o = me.overview;
  const questionCourse = instance?.courseLesson
    ? o.course.units
        .flatMap((u) => u.lessons)
        .find((l) => l.key === instance.courseLesson)
    : null;
  const progress = sessionProgress(
    studySession?.userId === me.user.id ? studySession : null,
  );
  if (!o.subjects.length)
    return (
      <div className="onboarding">
        <div className="brand">
          <span className="brand-mark">
            <Layers />
          </span>
          QUEST
        </div>
        <div className="step-label">01 / YOUR QUEST</div>
        <h1>
          あなたの受験科目を
          <br />
          選ぼう。
        </h1>
        <p className="muted">
          選んだ科目を、基礎の知識から順につなぐ。教材・記述・別問で、できることを増やす。
        </p>
        <SubjectPicker
          initial={[]}
          basicRanges={o.basicRanges}
          busy={busy}
          onSave={(ids, ranges) =>
            perform(async () => {
              const result = await api("/profile", {
                subjects: ids,
                basicRanges: ranges,
              });
              setMe({ ...me, overview: result });
              setInstance(result.instance);
            })
          }
        />
      </div>
    );
  return (
    <div
      className={
        "app " +
        (page === "quiz" ? "focus-quiz " : "") +
        (!o.settings.motion ? "reduce-motion" : "")
      }
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setPage("home");
          }}
        >
          <span className="brand-mark">
            <Layers size={23} />
          </span>
          QUEST
        </a>
        <div className="sidebar-caption">REJECT THE LIMIT. TAKE IT BACK.</div>
        <nav>
          {navItems.map(([id, label]) => {
            const Icon = icons[id];
            return (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => {
                  setToast("");
                  setPage(id);
                  setError("");
                  if (id === "ranking")
                    api("/rankings")
                      .then(setRanking)
                      .catch((e) => setError(e.message));
                }}
              >
                <Icon size={21} />
                <span>{label}</span>
                {id === "items" && o.inventory > 0 && <b>{o.inventory}</b>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="tiny-card">
            <Sparkles size={18} />
            <strong>まだ、決着じゃない。</strong>
            <p>点で奪い返す。次の1問から。</p>
          </div>
          <button className="account" onClick={() => setPage("settings")}>
            <span className="avatar">{me.user.name.slice(0, 1)}</span>
            <span>
              <strong>{me.user.name}</strong>
              <small>
                Lv.{o.level} · {o.rank} RANK
              </small>
            </span>
            <ChevronRight size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Layers size={21} />
            QUEST
          </div>
          <span className="top-context">
            QUEST / REBELLION <span className="dot" /> 決めつけを、得点で覆す。
          </span>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label={o.settings.sound ? "音をオフ" : "音をオン"}
              onClick={() =>
                perform(async () => {
                  const updated = await api("/profile", {
                    subjects: o.subjects,
                    basicRanges: o.basicRanges,
                    settings: { ...o.settings, sound: !o.settings.sound },
                  });
                  setMe({ ...me, overview: updated });
                })
              }
            >
              {o.settings.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            <span className="top-level">
              <Star size={16} />
              Lv.{o.level}
            </span>
            <span className="avatar">{me.user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className={"content " + (page === "quiz" ? "quiz-content" : "")}>
          {!online && (
            <div className="connection-banner" role="alert">
              通信が切れています。接続が戻ったら同じ操作を再送できます。
            </div>
          )}
          {error && (
            <div className="error global-error" role="alert">
              <div className="error-body">
                {error}
                {error.startsWith("今出せる問題がありません。") && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={enableGenerationAndStart}
                  >
                    AI新問生成を有効にして続ける
                  </button>
                )}
              </div>
              <button onClick={() => setError("")} aria-label="エラーを閉じる">
                <X size={18} />
              </button>
            </div>
          )}
          {page === "home" && (
            <StudyHome
              o={o}
              goal={studyGoal}
              onGoal={chooseGoal}
              onStart={() => setPage("course")}
              onPractice={start}
              onStats={() => setPage("stats")}
              onSettings={() => setPage("settings")}
              busy={busy}
              resuming={!!instance}
            />
          )}
          {page === "course" && (
            <CoursePage
              o={o}
              busy={busy}
              perform={perform}
              onSaved={courseSaved}
              onPractice={() => beginQuiz(true)}
            />
          )}
          {page === "quiz" && waiting && (
            <section className="card generation-wait" aria-live="polite">
              <div className="generation-orbit">
                <Sparkles size={44} />
              </div>
              <span className="eyebrow">次の1問</span>
              <h1>
                {generation?.plan?.state === "failed"
                  ? "新問を用意できなかった。"
                  : "次の1問を、準備中。"}
              </h1>
              <p>
                {generation?.plan?.state === "failed"
                  ? generation.plan.error
                  : "準備ができたら、自動で表示します。"}
              </p>
              {generation?.plan && (
                <span className="pill subtle">
                  {
                    subjects.find((s) => s.id === generation.plan!.subject)
                      ?.name
                  }{" "}
                  · {generation.plan.topic}
                </span>
              )}
              <p className="muted">準備中はXPブーストの時間を消費しません。</p>
              <div className="generation-actions">
                {generation?.plan?.state === "failed" && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        const g = await api<GenerationStatus>(
                          "/generation/retry",
                          {
                            planId: generation.plan!.id,
                            requestId: crypto.randomUUID(),
                          },
                        );
                        setGeneration(g);
                      })
                    }
                  >
                    もう一度作問する
                  </button>
                )}
                <button
                  className="button outlined"
                  disabled={busy}
                  onClick={storedQuestions}
                >
                  保存済み問題に切り替える
                </button>
                <button
                  className="button text"
                  onClick={() => {
                    setWaiting(false);
                    setPage("home");
                  }}
                >
                  ホームへ
                </button>
              </div>
            </section>
          )}
          {page === "quiz" && instance && (
            <>
              <div className="quiz-top">
                <button
                  className="text-button"
                  onClick={finishStudy}
                  disabled={busy}
                >
                  <ArrowLeft size={18} /> 終了・成果を見る
                </button>
                <div className="quiz-top-info">
                  {generation?.enabled && !!generation.buffer?.ready && (
                    <span className="buffer-indicator">
                      次の{generation.buffer.ready}問を準備済み
                    </span>
                  )}
                  {o.combo >= 2 && (
                    <span>
                      <Flame size={17} /> {o.combo}連続正解
                    </span>
                  )}
                  {o.boostRemaining > 0 && (
                    <span className="boost-indicator">
                      <Zap size={16} /> {Math.ceil(o.boostRemaining / 60)}分
                    </span>
                  )}
                  <button
                    className="icon-button"
                    aria-label={paused ? "再開" : "一時停止"}
                    onClick={() => setPaused(!paused)}
                  >
                    {paused ? <Play size={19} /> : <Pause size={19} />}
                  </button>
                </div>
              </div>
              {!questionCourse && (
                <div
                  className={
                    "focus-progress " +
                    (progress.reached ? "goal-complete" : "")
                  }
                  aria-label="今回の小さな目標"
                >
                  <span>
                    {progress.reached ? (
                      <Check size={17} />
                    ) : (
                      <Target size={17} />
                    )}{" "}
                    {progress.reached ? "目安を達成" : `まず${progress.goal}問`}
                  </span>
                  <strong>
                    {Math.min(progress.done, progress.goal)} / {progress.goal}
                    <small>
                      今回 {progress.total}問 · +{progress.xp} XP
                    </small>
                  </strong>
                  <progress
                    aria-label="今回の目安まで"
                    max={progress.goal}
                    value={Math.min(progress.done, progress.goal)}
                  />
                </div>
              )}
              <div className={"quiz-grid " + (notes ? "with-notes" : "")}>
                <section
                  className={
                    "question-card question-enter " +
                    (questionCourse ? "course-question" : "")
                  }
                  key={instance.id}
                  data-instance-id={instance.id}
                >
                  <div className="question-meta">
                    <span
                      className="subject-badge"
                      style={{
                        background: subjects.find(
                          (s) => s.id === instance.question.subject,
                        )?.color,
                      }}
                    >
                      {
                        subjects.find((s) => s.id === instance.question.subject)
                          ?.name
                      }
                    </span>
                    <span>
                      {instance.dueReview
                        ? "復習"
                        : o.bySubject.find(
                              (x) => x.id === instance.question.subject,
                            )?.answered === 0
                          ? "初めての科目"
                          : "新問"}
                    </span>
                    <span className="difficulty">
                      {"●".repeat(instance.question.difficulty)}
                      {"○".repeat(3 - instance.question.difficulty)}
                    </span>
                  </div>
                  <span className="question-topic">
                    {instance.question.topic}
                  </span>
                  <details className="question-details">
                    <summary>
                      問題の詳細
                      {instance.question.generation ? " · AI生成" : ""}
                    </summary>
                    <p>
                      作問目安 {instance.question.expectedSeconds}秒 ·
                      制限時間なし
                    </p>
                    {instance.question.generation && (
                      <>
                        <p>
                          AI生成・解答チェック済み。共有には運営の承認が必要です。
                        </p>
                        <label>
                          気になる点
                          <select
                            value={reportReason}
                            onChange={(e) =>
                              setReportReason(e.currentTarget.value)
                            }
                          >
                            <option>問題・正解に誤りがある</option>
                            <option>解説が不適切</option>
                            <option>曖昧で正解を選べない</option>
                            <option>範囲外・不適切な内容</option>
                          </select>
                        </label>
                        <button
                          className="button text generated-report"
                          disabled={busy}
                          onClick={() =>
                            perform(async () => {
                              const reason = reportReason;
                              const result = await api("/questions/report", {
                                questionId: instance.questionId,
                                reason,
                              });
                              setMe((m) =>
                                m ? { ...m, overview: result.overview } : m,
                              );
                              setPreparedNext(null);
                              setToast(
                                "報告を受け付けました。あなたへの出題から外しました。",
                              );
                              receiveNext(
                                await api("/next", { advance: true }),
                              );
                            })
                          }
                        >
                          問題を報告して次へ
                        </button>
                      </>
                    )}
                  </details>
                  {instance.study && !instance.courseLesson && (
                    <p className="study-context">
                      <span>{practiceNames[instance.study.kind]}</span>
                      {instance.study.reason}
                    </p>
                  )}
                  {!instance.answered && !instance.courseLesson && (
                    <FoundationPanel
                      key={instance.id}
                      instance={instance}
                      perform={perform}
                      onInstance={setInstance}
                    />
                  )}
                  {questionCourse && (
                    <div className="quiz-course-context">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setPage("course")}
                      >
                        <Layers size={15} />
                        {questionCourse.title}
                        <ChevronRight size={14} />
                      </button>
                      <CourseTrail steps={questionCourse.steps} compact />
                      {instance.answered && (
                        <small>
                          別問の自力確認 {Math.min(2, questionCourse.proof)}/2 ·
                          応用 {Math.min(1, questionCourse.transfer)}/1
                        </small>
                      )}
                    </div>
                  )}
                  <div
                    className="question-stem"
                    ref={questionRef}
                    tabIndex={-1}
                    role="group"
                    aria-label="問題文"
                  >
                    <StudyContent text={instance.question.stem} />
                  </div>
                  <RecallGate
                    key={instance.id}
                    instance={instance}
                    busy={busy || paused}
                    perform={perform}
                    onInstance={setInstance}
                  />
                  {(!!instance.answered || !!instance.responseMode) && (
                    <div
                      className="answer-options"
                      role="group"
                      aria-label="答えを1つ選ぶ"
                    >
                      {instance.question.options.map((option, index) => {
                        const r = instance.answered;
                        const isRight = r && option.id === r.correctOption,
                          isWrong = r && !r.correct && option.id === r.option;
                        return (
                          <button
                            key={option.id}
                            style={
                              {
                                "--option-delay": `${index * 35}ms`,
                              } as React.CSSProperties
                            }
                            disabled={busy || !!r || paused}
                            aria-label={`${String.fromCharCode(65 + index)} ${option.text}${isRight ? " 正解の選択肢" : isWrong ? " 選んだ答え・不正解" : ""}`}
                            className={
                              "option " +
                              (isRight ? "correct" : isWrong ? "wrong" : "")
                            }
                            onClick={() => submit(option.id)}
                          >
                            <span className="option-letter">
                              {String.fromCharCode(65 + index)}
                            </span>
                            <span>
                              <MathText text={option.text} />
                            </span>
                            {isRight ? (
                              <Check size={22} />
                            ) : isWrong ? (
                              <X size={22} />
                            ) : (
                              <small>{index + 1}</small>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!instance.answered ? (
                    <div className="question-tools">
                      <button
                        className="text-button"
                        disabled={busy || paused}
                        onClick={() => submit(null)}
                      >
                        わからない · 答えを見る
                      </button>
                      <div>
                        <button
                          className={"tool-button " + (notes ? "selected" : "")}
                          onClick={() => setNotes(!notes)}
                        >
                          <PenLine size={18} /> メモ
                        </button>
                        <button
                          className="tool-button hint-trigger"
                          onClick={() => void openHint()}
                        >
                          <Lightbulb size={18} /> ヒント
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={
                        "answer-result " +
                        (instance.answered.correct ? "right" : "incorrect")
                      }
                      role="status"
                    >
                      <div className="result-title">
                        <span>
                          {instance.answered.correct ? (
                            <Check size={26} />
                          ) : (
                            <BookOpen size={26} />
                          )}
                        </span>
                        <div>
                          <span className="result-kicker">
                            {instance.answered.correct
                              ? "TAKEN BACK"
                              : "WEAK POINT / EXPOSED"}
                          </span>
                          <h3>
                            {instance.answered.correct
                              ? "正解。ひとつ、奪還。"
                              : "弱点、暴いた。次は取る。"}
                          </h3>
                          <p>
                            +{instance.answered.xp} XP{" "}
                            {instance.answered.correct &&
                              !instance.hint &&
                              instance.answered.responseMode !==
                                "recognition" &&
                              instance.answered.learning > 0 &&
                              "· ヒントなし学習ボーナス"}
                          </p>
                        </div>
                      </div>
                      {reward?.id === instance.answered.id && (
                        <RewardEffects
                          key={reward.id}
                          reward={reward}
                          motion={o.settings.motion}
                        />
                      )}
                      <p className="feedback-detail">
                        {instance.answered.forgot
                          ? "覚えていなかったと記録した。復習で確認できる。"
                          : instance.answered.correct
                            ? instance.answered.responseMode === "recognition"
                              ? "選択肢を使って正解。学習の記録に残し、論点の自力確認は別の問いで確かめる。"
                              : instance.hint
                                ? "ヒントを使って正解。次は自力で取り切るために、考え方を持ち帰ろう。"
                                : instance.dueReview
                                  ? "前に解いた問題を、ヒントなしで思い出せた。"
                                  : "先に考えた答え・根拠を、ヒントなしの正解につなげた。別の問いでも確かめよう。"
                            : `次に「${instance.question.topic}」が出たときに取れるよう、解説で考え方をつかもう。`}
                      </p>
                      <Reflection
                        instance={instance}
                        busy={busy}
                        perform={perform}
                        onSaved={(r) => {
                          setMe({ ...me, overview: r.overview });
                          if (r.instance?.id === instance.id)
                            setInstance(r.instance);
                        }}
                      />
                      {progress.reached && (
                        <div className="checkpoint-note">
                          <Check size={18} />
                          <span>
                            {progress.goal}
                            問、一区切り。続けるか、ここで終えるかを選べる。
                          </span>
                        </div>
                      )}
                      {questionCourse?.steps[2] && (
                        <div className="course-application-complete">
                          <Check size={19} />
                          <div>
                            <strong>別問で使う段階を、クリア。</strong>
                            <p>
                              次は24時間以上空けて確認する。別の論点にも進める。
                            </p>
                            <button
                              className="text-button"
                              onClick={() => setPage("course")}
                            >
                              学習ルートを見る
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="result-actions">
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={
                            questionCourse?.steps[2]
                              ? () => setPage("course")
                              : advance
                          }
                          ref={nextButtonRef}
                        >
                          {questionCourse?.steps[2]
                            ? "次の知識へ進む"
                            : progress.reached
                              ? `もう${progress.goal}問続ける`
                              : "次の1問へ"}{" "}
                          <ArrowRight size={18} />
                        </button>
                        {progress.reached && (
                          <button
                            className="button outlined checkpoint-finish"
                            onClick={finishStudy}
                            disabled={busy}
                          >
                            ここで終える
                          </button>
                        )}
                        <small className="next-readiness" role="status">
                          {preparedNext?.previousId === instance.id
                            ? generation?.buffer?.ready
                              ? `次の${generation.buffer.ready}問を準備済み`
                              : "次の問題は準備済み"
                            : preparationError ||
                              (generation?.plan?.state === "failed"
                                ? "新問の準備を停止中"
                                : "次の問題を準備中")}
                        </small>
                        <button
                          className="text-button"
                          onClick={() => setExplain(!explain)}
                        >
                          {explain ? "解説を閉じる" : "解説を読む"}
                        </button>
                        {instance.answered.correct && (
                          <button
                            className="text-button forgot"
                            disabled={busy || instance.answered.forgot}
                            onClick={() =>
                              perform(async () => {
                                const r = await api("/forget", {
                                  instanceId: instance.id,
                                });
                                setInstance(r.instance);
                                setMe({ ...me, overview: r.overview });
                                setToast(
                                  "復習に戻しました。XP・コンボはそのまま。",
                                );
                              })
                            }
                          >
                            {instance.answered.forgot
                              ? "復習に戻しました"
                              : "覚えてなかった"}
                          </button>
                        )}
                      </div>
                      {instance.answered.xp === 0 && (
                        <small className="muted">
                          予定分を終えた追加練習です。XPは初回と期日復習で獲得できます。ドロップは毎問抽選します。
                        </small>
                      )}
                    </div>
                  )}
                  {explain && instance.answered && (
                    <section className="explanation">
                      <span className="eyebrow">答えの考え方</span>
                      <p>
                        <MathText text={instance.answered.explanation} />
                      </p>
                      <small>
                        次の復習：
                        {new Date(instance.answered.due).toLocaleString(
                          "ja-JP",
                        )}
                      </small>
                      <button
                        className="text-button"
                        onClick={() => void openHint()}
                      >
                        考え方のヒントを見る <ArrowUpRight size={16} />
                      </button>
                    </section>
                  )}
                  {paused && (
                    <div className="pause-cover">
                      <Pause size={36} />
                      <h2>ひとやすみ。</h2>
                      <p>ブーストの時間も止まります。</p>
                      <button
                        className="button primary"
                        onClick={() => setPaused(false)}
                      >
                        再開する <Play size={18} />
                      </button>
                    </div>
                  )}
                </section>
                {notes && (
                  <aside className="quiz-side">
                    <Notebook
                      key={instance.id}
                      id={instance.id}
                      initial={instance.note}
                    />
                  </aside>
                )}
              </div>
            </>
          )}
          {page === "summary" && (
            <div className="summary">
              <span className="summary-icon">
                <Sparkles size={48} />
              </span>
              <span className="eyebrow">YOUR COMEBACK / RECORDED</span>
              <h1>
                {progress.total
                  ? `${progress.total}問ぶん、反撃を刻んだ。`
                  : "反撃の続きは、残してある。"}
              </h1>
              <p className="muted">
                {progress.total
                  ? "今日の記録を、次の挑戦へ。時間を空けた復習で、自力で取れるか確かめよう。"
                  : "問題は保存済み。再開するときは、続きの1問から。"}
              </p>
              <div className="summary-metrics">
                <div>
                  <b>{progress.total}</b>
                  <span>解いた問題</span>
                </div>
                <div>
                  <b>+{progress.xp}</b>
                  <span>獲得XP</span>
                </div>
                <div>
                  <b>Lv.{o.level}</b>
                  <span>現在のレベル</span>
                </div>
              </div>
              {progress.total > 0 && (
                <p className="summary-learning">
                  新しく取り組んだ問題 {progress.newQuestions}問
                  {progress.recalled > 0 &&
                    ` · ヒントなしで思い出せた復習 ${progress.recalled}問`}
                </p>
              )}
              {o.course.active && (
                <section className="card summary-course">
                  <span className="eyebrow">知識の現在地</span>
                  <h2>{o.course.active.title}</h2>
                  <CourseTrail steps={o.course.active.steps} />
                  <p>
                    別問の自力確認 {Math.min(2, o.course.active.proof)}/2 · 応用{" "}
                    {Math.min(1, o.course.active.transfer)}/1
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setPage("course")}
                  >
                    学習ルートへ
                    <ArrowRight size={17} />
                  </button>
                </section>
              )}
              <div className="notice">
                <ShieldCheck size={20} /> 学習記録は保存済みです。
              </div>
              <div className="summary-actions">
                <button className="button outlined" onClick={start}>
                  もう少し解く <ArrowRight size={18} />
                </button>
                <button
                  className="button primary"
                  onClick={() => setPage("home")}
                >
                  ホームへ
                </button>
              </div>
            </div>
          )}
          {page === "stats" && (
            <LearningProgress
              o={o}
              busy={busy}
              perform={perform}
              onOverview={(overview) => setMe({ ...me, overview })}
            />
          )}
          {page === "items" && (
            <>
              <PageHeading
                eyebrow="YOUR INVENTORY"
                title="加速しろ。"
                description="解いた先に、ときどき届くレアドロップ。次のレベルへ加速する。"
              />
              <section className="boost-card">
                <div className="boost-art">
                  <Zap size={70} fill="currentColor" />
                  <span>×1.5</span>
                </div>
                <div>
                  <span className="pill orange">RARE · XP BOOST</span>
                  <h2>オーバードライブ</h2>
                  <p>
                    獲得XPが1.5倍に。効果はプレイ時間10分。
                    <br />
                    離席中やアプリを閉じた間は、時間が止まります。
                  </p>
                  <strong>所持数 {o.inventory}個</strong>
                  <button
                    className="button primary"
                    disabled={busy || o.inventory === 0 || o.boostRemaining > 0}
                    onClick={() =>
                      perform(async () => {
                        const updated = await api("/boost", {});
                        setMe({ ...me, overview: updated });
                        setToast(
                          "ブーストを使用しました。次の問題からXP1.5倍！",
                        );
                      })
                    }
                  >
                    {o.boostRemaining > 0
                      ? `使用中 · 残り${Math.ceil(o.boostRemaining / 60)}分`
                      : "ブーストを使う"}
                    <Zap size={18} />
                  </button>
                </div>
              </section>
              <p className="muted inventory-note">
                初期ドロップ率：2.5%（調整予定）。すべての回答完了時に抽選。確定獲得の天井はありません。ブーストはレベル育成に反映します。
              </p>
            </>
          )}
          {page === "ranking" && (
            <>
              <PageHeading
                eyebrow="THE LEADERBOARD"
                title="順番は、変えられる。"
                description="同じ受験科目構成の人と、問題難度を考慮した暫定レートで比較。"
              />
              <section className="card">
                <div className="section-title">
                  <h3>実力ランキング</h3>
                  <span className="pill subtle">初見・ヒントなし10問以上</span>
                </div>
                {!ranking ? (
                  <p className="empty">読み込み中…</p>
                ) : ranking.rankings.length ? (
                  <div className="leaderboard">
                    {ranking.rankings.map((r: any, i: number) => (
                      <div key={i}>
                        <b>#{i + 1}</b>
                        <span>{r.name}</span>
                        <span className="pill subtle">{r.rank}</span>
                        <strong>{r.rating}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <Trophy size={38} />
                    <h3>最初の記録を、刻もう。</h3>
                    <p>
                      初見・ヒントなしの回答が10問集まると参加します。
                      <br />
                      架空のユーザーや順位は表示しません。
                    </p>
                  </div>
                )}
              </section>
              <p className="muted">
                試用段階のランキングです。問題難度・レートは未校正。表示する総合ランクは最終更新時点のものです。
              </p>
            </>
          )}
          {page === "settings" && (
            <>
              <PageHeading
                eyebrow="MAKE IT YOURS"
                title="反撃の準備。"
                description="目標・配点・受験範囲を、学習の進め方に反映。"
              />
              <section className="card">
                <h3>受験科目</h3>
                <SubjectPicker
                  initial={o.subjects}
                  basicRanges={o.basicRanges}
                  busy={busy}
                  onSave={(ids, ranges) =>
                    perform(async () => {
                      const updated = await api("/profile", {
                        subjects: ids,
                        basicRanges: ranges,
                      });
                      setMe({ ...me, overview: updated });
                      setInstance(updated.instance);
                      setToast("受験科目を保存しました。");
                    })
                  }
                />
              </section>
              <GoalSettings
                key={o.subjects.join(",")}
                o={o}
                busy={busy}
                perform={perform}
                onSaved={(r) => {
                  setMe({ ...me, overview: r.overview });
                  setInstance(r.instance);
                  setPreparedNext(null);
                  setGeneration(null);
                  setToast("目標を保存しました。次の学習に反映します。");
                }}
              />
              <ProviderSettings
                busy={busy}
                perform={perform}
                notify={setToast}
                onChanged={async () => {
                  await reload();
                  setProviderVersion((v) => v + 1);
                }}
              />
              <GenerationSettings
                key={providerVersion}
                busy={busy}
                perform={perform}
                onSaved={async (g) => {
                  setGeneration(g);
                  await reload();
                  setToast(
                    g.enabled
                      ? "AI新問生成を有効にしました。"
                      : "保存済み問題に切り替えました。",
                  );
                }}
              />
              <section className="card preferences">
                <h3>音・アニメーション</h3>
                {(["sound", "motion"] as const).map((key) => (
                  <label key={key}>
                    <span>
                      {key === "sound"
                        ? "正解・レベルアップの効果音"
                        : "ゲームのアニメーション"}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={o.settings[key]}
                      onChange={(e) =>
                        perform(async () => {
                          const updated = await api("/profile", {
                            subjects: o.subjects,
                            basicRanges: o.basicRanges,
                            settings: {
                              ...o.settings,
                              [key]: e.target.checked,
                            },
                          });
                          setMe({ ...me, overview: updated });
                        })
                      }
                    />
                  </label>
                ))}
              </section>
              <DesignNotes />
              <p className="release-label">
                QUEST v{APP_VERSION} · 理解して、使って、思い出す。
              </p>
              <section className="card account-settings">
                <div>
                  <strong>{me.user.name}</strong>
                  <p>{me.user.email}</p>
                </div>
                <button className="button outlined" onClick={logout}>
                  <LogOut size={18} />
                  ログアウト
                </button>
              </section>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>QUEST / その評価、覆せ。</span>
          <span>v{APP_VERSION}</span>
        </footer>
      </div>
      <nav className="bottom-nav">
        {navItems.map(([id, label]) => {
          const Icon = icons[id];
          return (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setToast("");
                setPage(id);
                if (id === "ranking")
                  api("/rankings")
                    .then(setRanking)
                    .catch((e) => setError(e.message));
              }}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Sparkles size={21} />
          {toast}
        </div>
      )}
      {hintOpen && instance && (
        <div className="modal-backdrop" onClick={() => setHintOpen(false)}>
          <section
            className="hint-panel"
            role="dialog"
            aria-modal="true"
            aria-label="学習ヒント"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-title">
              <span className="hint-title">
                <Lightbulb size={24} />
                ここから学べるヒント
              </span>
              <button
                className="icon-button"
                onClick={() => setHintOpen(false)}
                aria-label="ヒントを閉じる"
              >
                <X size={22} />
              </button>
            </div>
            <p className="muted">
              知らなくても大丈夫。必要な知識と使い方をここで確認できます。
            </p>
            {hintText &&
              (hintStage === 3 && hintChat.length ? (
                <details className="hint-recap">
                  <summary>3段階のヒントを見返す</summary>
                  <HintResponse
                    text={hintAiText || hintText}
                    stage={hintStage}
                  />
                </details>
              ) : (
                <HintResponse text={hintAiText || hintText} stage={hintStage} />
              ))}
            {hintText && hintStage < 3 && (
              <button
                className="button primary wide hint-next"
                onClick={() => setHintStage((s) => Math.min(3, s + 1))}
              >
                {hintStage === 1 ? "公式・定義を見る" : "使い方を見る"}
                <ArrowRight size={18} />
              </button>
            )}
            {hintLoading && (
              <p role="status">
                <LoaderCircle className="spin" size={18} />{" "}
                {hintText
                  ? "AIがこの問題のヒントを準備しています…"
                  : "ヒントを読み込んでいます…"}
              </p>
            )}
            {hintStage === 3 && (
              <div className="hint-chat">
                <div className="chat-log" role="log" aria-label="AIとの会話">
                  {hintChat.map((turn, index) => (
                    <div key={index} className={"chat-bubble " + turn.role}>
                      <strong>{turn.role === "user" ? "あなた" : "AI"}</strong>
                      <ChatText text={turn.content} />
                      {turn.incomplete && (
                        <small className="muted">
                          ここまでの返信を保存しました
                        </small>
                      )}
                    </div>
                  ))}
                  {hintChatLoading && (
                    <div className="chat-bubble assistant streaming">
                      <strong>AI</strong>
                      {hintReply && <ChatText text={hintReply} />}
                      <p className="chat-status" role="status">
                        <span className="thinking-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        {hintChatStatus}
                      </p>
                    </div>
                  )}
                  <div ref={chatEnd} />
                </div>
                {!hintChatLoading && (
                  <div className="chat-suggestions" aria-label="質問の例">
                    {[
                      "もっとやさしく説明して",
                      "別の簡単な例で教えて",
                      "なぜそうなるの？",
                    ].map((message) => (
                      <button
                        type="button"
                        className="chip"
                        key={message}
                        onClick={() => {
                          setHintInput(message);
                          chatInput.current?.focus();
                        }}
                      >
                        {message}
                      </button>
                    ))}
                  </div>
                )}
                <form onSubmit={sendHintQuestion}>
                  <label htmlFor="hint-question">
                    まだわからないところを質問
                  </label>
                  <textarea
                    id="hint-question"
                    ref={chatInput}
                    value={hintInput}
                    onChange={(e) => setHintInput(e.target.value)}
                    maxLength={1000}
                    placeholder="例：この式のaとbは何？"
                    rows={2}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  {hintChatLoading ? (
                    <button
                      className="button outlined wide"
                      type="button"
                      onClick={() => chatAbort.current?.abort()}
                    >
                      <Pause size={17} />
                      返信を停止
                    </button>
                  ) : (
                    <button
                      className="button primary wide"
                      disabled={
                        hintChatLoading || hintLoading || !hintInput.trim()
                      }
                      type="submit"
                    >
                      質問する
                    </button>
                  )}
                  <small className="chat-input-help">
                    Ctrl / ⌘ + Enterで送信
                  </small>
                </form>
              </div>
            )}
            {hintError && <p role="alert">{hintError}</p>}
            {hintError && hintText && !hintAiText && (
              <button
                className="button secondary wide"
                disabled={hintLoading || hintChatLoading}
                onClick={() => void openHint(true)}
              >
                <RotateCcw size={18} /> AIヒントをもう一度作る
              </button>
            )}
            <small className="muted">
              ヒントを使っても通常XP。BYOK設定済みならAIが問題文に沿って説明します。再表示での重複呼び出しはありません。
            </small>
          </section>
        </div>
      )}
    </div>
  );
}
function ChatText({ text }: { text: string }) {
  return (
    <div className="chat-prose">
      {text.split(/\n\s*\n/).map((paragraph, index) => (
        <p key={index}>
          <MathText text={paragraph} />
        </p>
      ))}
    </div>
  );
}
function HintResponse({ text, stage }: { text: string; stage: number }) {
  return (
    <div className="hint-response" aria-live="polite">
      <span className="hint-stage-label">ヒント {stage} / 3</span>
      <HintLesson text={text} stage={stage} />
    </div>
  );
}
function HintLesson({ text, stage }: { text: string; stage: number }) {
  const [title, ...sections] = text.split("\n\n");
  const tailored = sections[0]?.startsWith("着眼点\n");
  return (
    <>
      <h3>{title}</h3>
      {!tailored && (
        <section className="hint-lesson-section">
          <h4>着眼点</h4>
          <p>
            「{title}
            」が手がかりです。知らない用語や公式は、次のヒントで確認できます。
          </p>
        </section>
      )}
      {sections
        .slice(0, tailored ? stage : Math.max(0, stage - 1))
        .map((section, index) => {
          const [label, ...body] = section.split("\n");
          return (
            <section className="hint-lesson-section" key={index}>
              <h4>{label}</h4>
              <p>
                <MathText text={body.join("\n")} />
              </p>
            </section>
          );
        })}
    </>
  );
}
function Progress({ value, tone = "green" }: { value: number; tone?: string }) {
  return (
    <div className={"progress " + tone}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  suffix,
  detail,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="metric">
      <div className="metric-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="metric-value">
        {value}
        <small>{suffix}</small>
      </div>
      {children}
      <p>{detail}</p>
    </section>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function SubjectPicker({
  initial,
  basicRanges,
  busy,
  onSave,
}: {
  initial: string[];
  basicRanges: string[];
  busy: boolean;
  onSave: (ids: string[], ranges: string[]) => void;
}) {
  const [selected, setSelected] = useState(initial),
    [ranges, setRanges] = useState(basicRanges);
  return (
    <div className="subject-picker">
      <div className="preset-row">
        <span>プリセット</span>
        <button onClick={() => setSelected(presetScience)}>理系</button>
        <button onClick={() => setSelected(presetArts)}>文系</button>
        <small>選択後も自由に変更できます</small>
      </div>
      {[...new Set(subjects.map((s) => s.group))].map((group) => (
        <fieldset key={group}>
          <legend>{group}</legend>
          <div>
            {subjects
              .filter((s) => s.group === group)
              .map((s) => (
                <button
                  type="button"
                  aria-pressed={selected.includes(s.id)}
                  className={
                    "subject-toggle " +
                    (selected.includes(s.id) ? "selected" : "")
                  }
                  key={s.id}
                  onClick={() =>
                    setSelected(
                      selected.includes(s.id)
                        ? selected.filter((x) => x !== s.id)
                        : [...selected, s.id],
                    )
                  }
                >
                  {selected.includes(s.id) && <Check size={15} />} {s.name}
                </button>
              ))}
          </div>
        </fieldset>
      ))}
      {selected.includes("basicScience") && (
        <fieldset>
          <legend>理科基礎の2範囲</legend>
          <div>
            {[
              ["biology", "生物基礎"],
              ["chemistry", "化学基礎"],
              ["physics", "物理基礎"],
              ["earth", "地学基礎"],
            ].map(([id, label]) => (
              <button
                aria-pressed={ranges.includes(id)}
                className={
                  "subject-toggle " + (ranges.includes(id) ? "selected" : "")
                }
                key={id}
                onClick={() =>
                  setRanges(
                    ranges.includes(id)
                      ? ranges.filter((x) => x !== id)
                      : ranges.length < 2
                        ? [...ranges, id]
                        : [ranges[1], id],
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="subject-save">
        <span>{selected.length}科目を選択中</span>
        <button
          className="button primary"
          disabled={
            busy ||
            !selected.length ||
            (selected.includes("basicScience") && ranges.length !== 2)
          }
          onClick={() =>
            onSave(
              selected,
              ranges.length === 2 ? ranges : ["biology", "chemistry"],
            )
          }
        >
          科目を保存 <ArrowRight size={18} />
        </button>
      </div>
      <small className="muted">
        初期問題がある科目を表示しています。理科基礎は2範囲で1科目として抽選します。
      </small>
    </div>
  );
}
function ProviderSettings({
  busy,
  perform,
  notify,
  onChanged,
}: {
  busy: boolean;
  perform: (fn: () => Promise<void>) => Promise<void>;
  notify: (s: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [format, setFormat] = useState("openai"),
    [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1"),
    [model, setModel] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [opencodeSession, setOpencodeSession] = useState(""),
    [configured, setConfigured] = useState(false);
  useEffect(() => {
    api("/provider")
      .then((r) => {
        if (r.config) {
          setConfigured(true);
          setFormat(r.config.format);
          setBaseUrl(r.config.base_url);
          setModel(r.config.model);
          setOpencodeSession(r.config.opencode_session || "");
        }
      })
      .catch(() => {});
  }, []);
  return (
    <section className="card provider-settings">
      <div className="section-title">
        <h3>
          <Sparkles size={20} /> BYOK — AIの先生
        </h3>
        <span className={"pill " + (configured ? "subtle" : "")}>
          {configured ? "設定済み" : "未設定"}
        </span>
      </div>
      <p className="muted">
        OpenAI互換・Anthropic互換のAPIに接続。キーはサーバーで暗号化し、別端末でも利用できます。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            const enableGeneration =
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                "value",
              ) !== "connection-only";
            await api("/provider", {
              format,
              baseUrl,
              model,
              apiKey,
              opencodeSession,
              enableGeneration,
            });
            setApiKey("");
            setConfigured(true);
            await onChanged();
            notify(
              enableGeneration
                ? "APIキーを保存し、AI新問生成を有効にしました。"
                : "AIの接続設定を保存しました。",
            );
          });
        }}
      >
        <div className="form-grid">
          <label>
            API形式
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                setBaseUrl(
                  e.target.value === "anthropic"
                    ? "https://api.anthropic.com/v1"
                    : "https://api.openai.com/v1",
                );
              }}
            >
              <option value="openai">OpenAI互換</option>
              <option value="anthropic">Anthropic互換</option>
            </select>
          </label>
          <label>
            モデル名
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="利用するモデルのID"
              required
            />
          </label>
        </div>
        <label>
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            type="url"
            required
          />
        </label>
        <label>
          APIキー
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            autoComplete="off"
            placeholder={
              configured ? "変更するときはキーを再入力" : "APIキーを入力"
            }
          />
        </label>
        <label>
          x-opencode-session（任意）
          <input
            value={opencodeSession}
            onChange={(e) => setOpencodeSession(e.target.value)}
            maxLength={200}
            pattern="[A-Za-z0-9._:-]*"
            placeholder="空欄ならセッションIDを自動生成"
          />
          <small className="muted">
            接続先から指定されたIDがある場合に入力。作問・検証・AIヒントで共通に使います。
          </small>
        </label>
        <div className="provider-actions">
          <button
            className="button primary"
            disabled={busy}
            type="submit"
            value="generate"
          >
            保存して新問生成を有効にする <ShieldCheck size={17} />
          </button>
          <button
            className="button outlined"
            disabled={busy}
            type="submit"
            value="connection-only"
          >
            接続設定だけ保存
          </button>
          {configured && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                perform(async () => {
                  await api("/provider", undefined, "DELETE");
                  setConfigured(false);
                  await onChanged();
                  notify("AI設定を削除しました。");
                })
              }
            >
              設定を削除
            </button>
          )}
        </div>
      </form>
      <small className="muted">
        新問生成を有効にすると、作問・解答チェックに保存したAPIを使います。1問につき原則2回の呼び出しで、10-shot見本の分だけ入力トークンも増えます。
      </small>
      <small className="muted">
        ヒントの方針とプロンプトは運営が用意します。キーの平文は画面やログに返しません。
      </small>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
