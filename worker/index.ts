import { promotePrepared } from "./prepared";
import { defaultHint } from "./hints";
import {
  questionChat,
  CHAT_PIPELINE_VERSION,
  type ChatProgress,
} from "./question-chat";
import { chatStream } from "./chat-stream";
import { APP_VERSION } from "../shared/release";
import { mathOptions, errorNames, jstDay } from "../shared/study";
import { withinStudyScope, curriculumFor } from "./study-plan";
import { foundationLesson } from "./study-lessons";
import {
  readCourse,
  attemptCourse,
  selectedCourse,
  touchCourseSupport,
} from "./course";
import { courseKey, emptyCourse } from "../shared/course";
import {
  questionHint,
  HINT_PIPELINE_VERSION,
  HintValidationError,
} from "./question-hints";
import { z } from "zod";
import { providerFor } from "./llm";
import {
  generationStatus,
  fillGenerationBuffer,
  configureGeneration,
  ensurePlan,
  retryPlan,
  nextLiveQuestion,
  runGeneration,
  reportGenerated,
  invalidatePlans,
} from "./generation";
import { subjects } from "./catalog";
import {
  load,
  mutate,
  bankCount,
  cohortKey,
  refreshRanking,
} from "./repository";
import {
  answer,
  forget,
  overview,
  publicInstance,
  heartbeat,
  questionsFor,
  rankNames,
} from "./engine";
import {
  type Env,
  HttpError,
  fail,
  token,
  hash,
  accountPassword,
  passwordNeedsUpgrade,
  checkPassword,
  cleanup,
  secureResponse,
  equal,
  cookie,
  sessionCookie,
  seal,
  validateBase,
  local,
  mail,
  rate,
} from "./security";
type User = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  verified: number;
  google_sub: string | null;
};
const json = (data: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
async function body<T>(req: Request, schema: z.ZodType<T>) {
  let data: unknown;
  try {
    const reader = req.body?.getReader();
    if (!reader) fail(400, "入力内容を確認してください。");
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 500000) {
        await reader.cancel();
        fail(413, "データが大きすぎます。");
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "入力内容を確認してください。");
  }
  const result = schema.safeParse(data);
  if (!result.success) fail(400, result.error.issues[0].message);
  return result.data;
}
async function currentUser(req: Request, env: Env) {
  const value = cookie(req, "quest_session");
  if (!value) return null;
  return env.DB.prepare(
    "SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.verified=1",
  )
    .bind(await hash(value), Date.now())
    .first<User>();
}
async function issueSession(env: Env, user: User) {
  const value = token();
  await env.DB.prepare("INSERT INTO sessions VALUES(?,?,?)")
    .bind(await hash(value), user.id, Date.now() + 30 * 86400000)
    .run();
  return value;
}
async function auth(req: Request, env: Env, path: string, url: URL) {
  const creds = z.object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((x) => x.toLowerCase()),
    password: z
      .string()
      .min(10, "パスワードは10文字以上にしてください。")
      .max(128),
    name: z.string().min(1).max(40).optional(),
  });
  if (path === "/api/auth/register" && req.method === "POST") {
    const b = await body(req, creds);
    await rate(
      env,
      `register:${req.headers.get("CF-Connecting-IP") ?? "local"}`,
    );
    await rate(env, `register-account:${await hash(b.email)}`, 3);
    if (!local(env) && (!env.RESEND_API_KEY || !env.MAIL_FROM))
      fail(503, "メール配信を設定してから登録を開始してください。");
    const id = crypto.randomUUID(),
      t = token();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)",
      ).bind(
        id,
        b.email,
        b.name ?? "学習者",
        await accountPassword(b.password, env),
        Date.now(),
      ),
      env.DB.prepare(
        "INSERT INTO auth_tokens(token_hash,user_id,kind,payload,expires_at) SELECT ?,id,'verify',NULL,? FROM users WHERE email=?",
      ).bind(await hash(t), Date.now() + 86400000, b.email),
    ]);
    const link = `${env.APP_ORIGIN}/api/auth/verify?token=${t}`;
    const devLink = await mail(env, b.email, link, "verify");
    return json(
      { message: "確認メールから登録を完了してください。", devLink },
      201,
    );
  }
  if (path === "/api/auth/verify" && req.method === "GET") {
    const t = url.searchParams.get("token") ?? "";
    const row = await env.DB.prepare(
      "DELETE FROM auth_tokens WHERE token_hash=? AND kind=? AND expires_at>? RETURNING user_id",
    )
      .bind(await hash(t), "verify", Date.now())
      .first<{ user_id: string }>();
    if (!row) fail(400, "リンクの期限が切れています。");
    await env.DB.prepare("UPDATE users SET verified=1 WHERE id=?")
      .bind(row.user_id)
      .run();
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_ORIGIN}/?verified=1`,
      },
    });
  }
  if (path === "/api/auth/login" && req.method === "POST") {
    const b = await body(req, creds);
    await rate(
      env,
      `login:${req.headers.get("CF-Connecting-IP") ?? "local"}:${b.email}`,
    );
    await rate(
      env,
      `login-ip:${req.headers.get("CF-Connecting-IP") ?? "local"}`,
      30,
    );
    await rate(env, `login-account:${await hash(b.email)}`, 30);
    const u = await env.DB.prepare("SELECT * FROM users WHERE email=?")
      .bind(b.email)
      .first<User>();
    const valid = u?.password_hash
      ? await checkPassword(b.password, u.password_hash, env)
      : (await accountPassword(b.password, env, "dummy-salt"), false);
    if (!u?.password_hash || !valid)
      fail(401, "メールアドレスまたはパスワードが違います。");
    if (!u.verified) fail(403, "メール確認を完了してください。");
    if (passwordNeedsUpgrade(u.password_hash))
      await env.DB.prepare(
        "UPDATE users SET password_hash=? WHERE id=? AND password_hash=?",
      )
        .bind(await accountPassword(b.password, env), u.id, u.password_hash)
        .run();
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(await issueSession(env, u), env),
    });
  }
  if (path === "/api/auth/logout" && req.method === "POST") {
    const t = cookie(req, "quest_session");
    if (t)
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await hash(t))
        .run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", env, 0) });
  }
  if (path === "/api/auth/reset-request" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        email: z
          .string()
          .email()
          .transform((x) => x.toLowerCase()),
      }),
    );
    await rate(env, `reset:${req.headers.get("CF-Connecting-IP") ?? "local"}`);
    const u = await env.DB.prepare("SELECT * FROM users WHERE email=?")
      .bind(b.email)
      .first<User>();
    let devLink;
    if (u?.password_hash) {
      const t = token();
      await env.DB.prepare("INSERT INTO auth_tokens VALUES(?,?,?,?,?)")
        .bind(await hash(t), u.id, "reset", null, Date.now() + 1800000)
        .run();
      devLink = await mail(
        env,
        b.email,
        `${env.APP_ORIGIN}/?reset=${t}`,
        "reset",
      );
    }
    return json({
      message: "登録済みの場合、再設定リンクを送信しました。",
      devLink,
    });
  }
  if (path === "/api/auth/reset" && req.method === "POST") {
    await rate(
      env,
      `reset-submit:${req.headers.get("CF-Connecting-IP") ?? "local"}`,
      30,
    );
    const b = await body(
      req,
      z.object({ token: z.string(), password: z.string().min(10).max(128) }),
    );
    const row = await env.DB.prepare(
      "SELECT user_id FROM auth_tokens WHERE token_hash=? AND kind=? AND expires_at>?",
    )
      .bind(await hash(b.token), "reset", Date.now())
      .first<{ user_id: string }>();
    if (!row) fail(400, "リンクの期限が切れています。");
    const newHash = await accountPassword(b.password, env);
    const reset = await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET password_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND user_id=users.id AND kind='reset' AND expires_at>?) RETURNING id",
      ).bind(newHash, row.user_id, await hash(b.token), Date.now()),
      env.DB.prepare(
        "DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)",
      ).bind(row.user_id, row.user_id, newHash),
      env.DB.prepare(
        "DELETE FROM auth_tokens WHERE user_id=? AND kind='reset' AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)",
      ).bind(row.user_id, row.user_id, newHash),
    ]);
    if (!reset[0].results.length) fail(400, "リンクの期限が切れています。");
    return json({ ok: true });
  }
  if (path === "/api/auth/google" && req.method === "GET") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
      fail(503, "Googleログインは運営の接続設定後に利用できます。");
    const state = token(),
      nonce = token(),
      verifier = token();
    await env.DB.prepare("INSERT INTO auth_tokens VALUES(?,?,?,?,?)")
      .bind(
        await hash(state),
        null,
        "oauth",
        JSON.stringify({ nonce, verifier }),
        Date.now() + 600000,
      )
      .run();
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: (await hash(verifier))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", ""),
      code_challenge_method: "S256",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: u.toString(),
        "Set-Cookie": `quest_oauth=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`,
      },
    });
  }
  if (path === "/api/auth/google/callback" && req.method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    if (!state || !equal(state, cookie(req, "quest_oauth") ?? ""))
      fail(400, "認証をやり直してください。");
    const row = await env.DB.prepare(
      "DELETE FROM auth_tokens WHERE token_hash=? AND kind=? AND expires_at>? RETURNING payload",
    )
      .bind(await hash(state), "oauth", Date.now())
      .first<{ payload: string }>();
    if (!row) fail(400, "認証の期限が切れています。");
    const { verifier } = JSON.parse(row.payload);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code: url.searchParams.get("code") ?? "",
        code_verifier: verifier,
      }),
    });
    if (!r.ok) fail(401, "Google認証を完了できませんでした。");
    const tokens = (await r.json()) as { access_token: string };
    const info = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!info.ok) fail(401, "Googleユーザー情報を取得できませんでした。");
    const p = (await info.json()) as {
      sub: string;
      email: string;
      email_verified: boolean;
      name?: string;
    };
    if (!p.email_verified)
      fail(403, "確認済みのGoogleアカウントを利用してください。");
    let u = await env.DB.prepare("SELECT * FROM users WHERE google_sub=?")
      .bind(p.sub)
      .first<User>();
    if (!u) {
      const existing = await env.DB.prepare(
        "SELECT id FROM users WHERE email=?",
      )
        .bind(p.email.toLowerCase())
        .first();
      if (existing)
        fail(
          409,
          "同じメールのアカウントがあります。メール・パスワードでログインしてください。自動連携は行いません。",
        );
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO users(id,email,name,google_sub,verified,created_at) VALUES(?,?,?,?,1,?)",
      )
        .bind(
          id,
          p.email.toLowerCase(),
          p.name ?? p.email.split("@")[0],
          p.sub,
          Date.now(),
        )
        .run();
      u = await env.DB.prepare("SELECT * FROM users WHERE id=?")
        .bind(id)
        .first<User>();
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: env.APP_ORIGIN,
        "Set-Cookie": sessionCookie(await issueSession(env, u!), env),
      },
    });
  }
  return null;
}
async function warmBuffer(env: Env, id: string, ctx?: ExecutionContext) {
  const work = fillGenerationBuffer(env, id);
  if (ctx) ctx.waitUntil(work);
  else await work;
}
async function api(req: Request, env: Env, ctx?: ExecutionContext) {
  const url = new URL(req.url),
    path = url.pathname;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (req.headers.get("Origin") !== env.APP_ORIGIN)
      fail(403, "同じサイトから操作してください。");
    if (!req.headers.get("Content-Type")?.startsWith("application/json"))
      fail(415, "JSON形式で送信してください。");
    if (Number(req.headers.get("Content-Length") ?? 0) > 500000)
      fail(413, "データが大きすぎます。");
  }
  if (path === "/api/health") return json({ ok: true, version: APP_VERSION });
  if (path === "/api/catalog")
    return json({
      subjects,
      bankCount: await bankCount(env),
      googleConfigured: !!env.GOOGLE_CLIENT_ID,
    });
  if (path.startsWith("/api/auth/")) {
    const response = await auth(req, env, path, url);
    if (response) return response;
  }
  const u = await currentUser(req, env);
  if (!u) fail(401, "ログインしてください。");
  const user = u!;
  const limits: Record<string, number> = {
    "/api/me": 120,
    "/api/answer": 300,
    "/api/profile": 30,
    "/api/next": 300,
    "/api/next/prepare": 300,
    "/api/note": 300,
    "/api/heartbeat": 300,
    "/api/provider": 30,
    "/api/forget": 60,
    "/api/rankings": 60,
    "/api/generation/config": 30,
    "/api/study-goal": 30,
    "/api/exam-results": 30,
    "/api/lesson": 120,
    "/api/reflection": 120,
    "/api/course/route": 60,
    "/api/course/lesson": 120,
    "/api/course/check": 120,
    "/api/recall": 300,
  };
  if (limits[path]) await rate(env, `api:${user.id}:${path}`, limits[path]);
  if (path === "/api/me") {
    const snapshot = await load(env, user.id);
    return json({
      user: { id: user.id, name: user.name, email: user.email },
      overview: await refreshRanking(env, user.id, snapshot),
      instance: publicInstance(snapshot.state),
    });
  }
  if (path === "/api/profile" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        subjects: z
          .array(z.enum(subjects.map((x) => x.id) as [string, ...string[]]))
          .min(1)
          .max(15)
          .transform((x) => [...new Set(x)]),
        basicRanges: z
          .array(z.enum(["biology", "chemistry", "physics", "earth"]))
          .length(2)
          .optional(),
        settings: z
          .object({ sound: z.boolean(), motion: z.boolean() })
          .optional(),
      }),
    );
    if (b.basicRanges && new Set(b.basicRanges).size !== 2)
      fail(400, "理科基礎は異なる2範囲を選んでください。");
    await mutate(
      env,
      user.id,
      (s) => {
        s.subjects = b.subjects;
        if (b.basicRanges) s.basicRanges = b.basicRanges;
        if (b.settings) s.settings = b.settings;
        if (
          s.course?.active &&
          !curriculumFor(s).some(
            (u) =>
              u.subject === s.course.active!.subject &&
              u.topic === s.course.active!.topic,
          )
        )
          s.course.active = null;
        const q = questionsFor(s).find((q) => q.id === s.instance?.questionId);
        if (
          q &&
          (!s.subjects.includes(q.subject) ||
            (q.basicRange && !s.basicRanges.includes(q.basicRange)))
        )
          s.instance = null;
      },
      "current",
    );
    const updated = await load(env, user.id);
    await refreshRanking(env, user.id, updated);
    return json({
      ...overview(updated.state),
      instance: publicInstance(updated.state),
    });
  }
  if (path === "/api/study-goal" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        examDate: z
          .string()
          .regex(/^20\d{2}-\d{2}-\d{2}$/)
          .refine((x) => {
            const t = Date.parse(x + "T00:00:00Z");
            return (
              Number.isFinite(t) &&
              new Date(t).toISOString().slice(0, 10) === x &&
              x >= "2026-01-01" &&
              x <= "2035-12-31"
            );
          }),
        targetPercent: z.number().int().min(1).max(100),
        dailyMinutes: z.number().int().min(5).max(240),
        weights: z
          .record(z.string(), z.number().int().min(1).max(1000))
          .refine((x) =>
            Object.keys(x).every((id) => subjects.some((s) => s.id === id)),
          ),
        mathOptions: z
          .array(z.enum(mathOptions))
          .length(3)
          .refine((x) => new Set(x).size === 3),
      }),
    );
    await mutate(
      env,
      user.id,
      (s) => {
        s.studyGoal = b;
        if (
          s.course?.active &&
          !curriculumFor(s).some(
            (u) =>
              u.subject === s.course.active!.subject &&
              u.topic === s.course.active!.topic,
          )
        )
          s.course.active = null;
        const q = questionsFor(s).find((q) => q.id === s.instance?.questionId);
        if (q && !withinStudyScope(s, q)) s.instance = null;
      },
      "current",
    );
    await invalidatePlans(env, user.id);
    const updated = await load(env, user.id);
    return json({
      overview: await refreshRanking(env, user.id, updated),
      instance: publicInstance(updated.state),
    });
  }
  if (path.startsWith("/api/course/") && req.method === "POST") {
    const selection = z.object({
      subject: z.string().max(40),
      topic: z.string().max(100),
      lesson: z.string().max(100),
    });
    if (path === "/api/course/route") {
      const b = await body(req, z.object({ selection: selection.nullable() }));
      let changed = false;
      await mutate(
        env,
        user.id,
        (s) => {
          if (b.selection) selectedCourse(s, b.selection);
          s.course ??= emptyCourse();
          changed =
            JSON.stringify(s.course.active) !== JSON.stringify(b.selection);
          if (changed) {
            s.course.active = b.selection;
            s.instance = null;
          }
        },
        "current",
      );
      if (changed) await invalidatePlans(env, user.id);
      const updated = await load(env, user.id);
      return json({
        overview: overview(updated.state),
        instance: publicInstance(updated.state),
      });
    }
    if (path === "/api/course/lesson") {
      const b = await body(req, selection);
      return json(
        await mutate(env, user.id, (s) => ({
          lesson: readCourse(s, b),
          overview: overview(s),
        })),
      );
    }
    if (path === "/api/course/check") {
      const b = await body(
        req,
        selection.extend({
          input: z.string().trim().min(1).max(1000),
          requestId: z.string().uuid(),
        }),
      );
      return json(
        await mutate(env, user.id, (s) => ({
          result: attemptCourse(s, b, b.input, b.requestId),
          overview: overview(s),
        })),
      );
    }
  }
  if (path === "/api/recall" && req.method === "POST") {
    const b = await body(
      req,
      z
        .object({
          instanceId: z.string().uuid(),
          mode: z.enum(["recall", "recognition"]),
          input: z.string().trim().max(1000).default(""),
        })
        .refine((b) => b.mode !== "recall" || b.input.length >= 1),
    );
    return json(
      await mutate(
        env,
        user.id,
        (s) => {
          const i = s.instance;
          if (
            !i ||
            i.id !== b.instanceId ||
            s.answers.some((a) => a.instanceId === i.id)
          )
            fail(409, "現在の未回答の問題から操作してください。");
          // Freeze the draft before choices are revealed. A later retry cannot
          // turn recognition into a pre-choice response.
          if (!i.responseMode) {
            i.responseMode = b.mode;
            i.recallDraft = b.input;
          }
          return { instance: publicInstance(s) };
        },
        "current",
      ),
    );
  }
  if (path === "/api/exam-results" && req.method === "POST") {
    const score = z
      .object({
        subject: z.enum(subjects.map((x) => x.id) as [string, ...string[]]),
        score: z.number().min(0).max(1000),
        maxScore: z.number().min(1).max(1000),
      })
      .refine((x) => x.score <= x.maxScore);
    const b = await body(
      req,
      z.union([
        z.object({ remove: z.string().uuid() }),
        z.object({
          id: z.string().uuid(),
          date: z
            .string()
            .regex(/^20\d{2}-\d{2}-\d{2}$/)
            .refine((x) => {
              const t = Date.parse(x + "T00:00:00Z");
              return (
                Number.isFinite(t) &&
                new Date(t).toISOString().slice(0, 10) === x &&
                x <= jstDay(Date.now()) &&
                x >= "2000-01-01"
              );
            }),
          label: z.string().trim().min(1).max(80),
          timed: z.boolean(),
          scores: z
            .array(score)
            .min(1)
            .max(15)
            .refine((x) => new Set(x.map((s) => s.subject)).size === x.length),
        }),
      ]),
    );
    return json(
      await mutate(env, user.id, (s) => {
        if ("remove" in b)
          s.examRecords = s.examRecords.filter((r) => r.id !== b.remove);
        else {
          if (b.scores.some((r) => !s.subjects.includes(r.subject)))
            fail(400, "登録した受験科目の得点を入力してください。");
          const index = s.examRecords.findIndex((r) => r.id === b.id);
          if (index < 0 && s.examRecords.length >= 100)
            fail(
              409,
              "得点記録は100件まで保存できます。古い記録を整理してください。",
            );
          if (index < 0) s.examRecords.push(b);
          else s.examRecords[index] = b;
        }
        return overview(s);
      }),
    );
  }
  if (path === "/api/lesson" && req.method === "POST") {
    const b = await body(req, z.object({ instanceId: z.string().uuid() }));
    return json(
      await mutate(
        env,
        user.id,
        (s) => {
          if (!s.instance || s.instance.id !== b.instanceId)
            fail(409, "現在の問題から基礎教材を開いてください。");
          const q = questionsFor(s).find(
            (q) => q.id === s.instance!.questionId,
          );
          if (!q) fail(409, "問題を読み込み直してください。");
          if (!s.answers.some((a) => a.instanceId === b.instanceId))
            s.instance.hint = true;
          s.instance.instructionSeen = true;
          touchCourseSupport(s, s.instance.courseLesson);
          const lesson =
            s.instance.courseLesson &&
            s.course?.active &&
            s.instance.courseLesson === courseKey(s.course.active)
              ? selectedCourse(s, s.course.active).lesson
              : foundationLesson(q);
          return { lesson, instance: publicInstance(s) };
        },
        "current",
      ),
    );
  }
  if (path === "/api/reflection" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        instanceId: z.string().uuid(),
        kind: z.enum(
          Object.keys(errorNames) as [
            keyof typeof errorNames,
            ...(keyof typeof errorNames)[],
          ],
        ),
      }),
    );
    return json(
      await mutate(env, user.id, (s) => {
        const a = s.answers.find((a) => a.instanceId === b.instanceId);
        if (!a || (a.correct && !a.hint && !a.forgot))
          fail(400, "振り返る回答を選んでください。");
        a.errorKind = b.kind;
        return { overview: overview(s), instance: publicInstance(s) };
      }),
    );
  }
  if (path === "/api/next" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        advance: z.boolean().optional(),
        preparedId: z.string().uuid().optional(),
        previousId: z.string().uuid().optional(),
      }),
    );
    const result =
      b.preparedId && b.previousId
        ? await promotePrepared(env, user.id, b.preparedId, b.previousId)
        : await nextLiveQuestion(env, user.id, !!b.advance);
    await warmBuffer(env, user.id, ctx);
    return json(result, result && "waiting" in result ? 202 : 200);
  }
  if (path === "/api/next/prepare" && req.method === "POST") {
    await body(req, z.object({}));
    const result = await nextLiveQuestion(env, user.id, false, true);
    await warmBuffer(env, user.id, ctx);
    return json(result, result && "waiting" in result ? 202 : 200);
  }
  if (path === "/api/answer" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        instanceId: z.string().uuid(),
        option: z.string().max(20).nullable(),
        activeMs: z.number().int().min(0).max(1800000).optional(),
      }),
    );
    return json(
      await mutate(env, user.id, (s) => {
        if (s.instance?.id === b.instanceId && !s.instance.responseMode)
          s.instance.responseMode = "recognition";
        const result = answer(s, b.instanceId, b.option);
        const event = s.answers.find((a) => a.instanceId === b.instanceId)!;
        if (event.activeMs === undefined && b.activeMs !== undefined)
          event.activeMs = Math.min(
            b.activeMs,
            Math.max(0, Date.now() - (s.instance?.started ?? Date.now())),
            1800000,
          );
        return {
          result: { ...result, activeMs: event.activeMs },
          overview: overview(s),
        };
      }),
    );
  }
  if (path === "/api/forget" && req.method === "POST") {
    const b = await body(req, z.object({ instanceId: z.string().uuid() }));
    return json(
      await mutate(env, user.id, (s) => {
        forget(s, b.instanceId);
        return { instance: publicInstance(s), overview: overview(s) };
      }),
    );
  }
  if (path === "/api/note" && req.method === "POST") {
    const b = await body(
      req,
      z.object({ instanceId: z.string().uuid(), note: z.string().max(150000) }),
    );
    return json(
      await mutate(
        env,
        user.id,
        (s) => {
          if (s.instance?.id !== b.instanceId)
            fail(409, "問題が切り替わりました。");
          s.instance!.note = b.note;
          return { ok: true };
        },
        false,
      ),
    );
  }
  if (path === "/api/boost" && req.method === "POST") {
    return json(
      await mutate(env, user.id, (s) => {
        if (s.inventory < 1) fail(400, "ブーストをまだ持っていません。");
        if (s.boostRemaining > 0) fail(409, "使用中のブーストが残っています。");
        s.inventory--;
        s.boostRemaining = 600;
        s.boostAt = Date.now();
        s.boostActive = false;
        return overview(s);
      }),
    );
  }
  if (path === "/api/heartbeat" && req.method === "POST") {
    const b = await body(
      req,
      z.object({ lease: z.string().uuid(), active: z.boolean() }),
    );
    return json(
      await mutate(
        env,
        user.id,
        (s) => ({
          remaining: heartbeat(s, b.lease, b.active),
        }),
        false,
      ),
    );
  }
  if (path === "/api/rankings") {
    const own = cohortKey((await load(env, user.id, false)).state);
    const [rows, count] = await env.DB.batch([
      env.DB.prepare(
        "SELECT u.name,p.rating,p.rank_index,p.observations,p.updated_at FROM learning_profiles p JOIN users u ON u.id=p.user_id WHERE u.verified=1 AND p.cohort=? AND p.observations>=10 ORDER BY p.rating DESC,p.user_id LIMIT 100",
      ).bind(own),
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM learning_profiles p JOIN users u ON u.id=p.user_id WHERE u.verified=1 AND p.cohort=? AND p.observations>=10",
      ).bind(own),
    ]);
    const rankings = rows.results.map((r: any) => ({
      name: r.name,
      rating: r.rating,
      rank: rankNames[r.rank_index],
      observations: r.observations,
      updatedAt: r.updated_at,
    }));
    return json({
      rankings,
      population: (count.results[0] as { count: number }).count,
      provisional: true,
    });
  }
  if (path === "/api/generation" && req.method === "GET")
    return json(await generationStatus(env, user.id));
  if (path === "/api/generation/config" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        enabled: z.boolean(),
        dailyLimit: z.number().int().nonnegative().nullable().optional(),
        verificationModel: z.string().trim().max(150),
      }),
    );
    return json(
      await configureGeneration(env, user.id, {
        enabled: b.enabled ? 1 : 0,
        daily_limit: 0,
        verification_model: b.verificationModel,
      }),
    );
  }
  if (path === "/api/generation/prefetch" && req.method === "POST") {
    const b = await body(req, z.object({ requestId: z.string().uuid() }));
    return json(await ensurePlan(env, user.id, b.requestId));
  }
  if (path === "/api/generation/retry" && req.method === "POST") {
    const b = await body(
      req,
      z.object({ planId: z.string().uuid(), requestId: z.string().uuid() }),
    );
    const result = await retryPlan(env, user.id, b.planId, b.requestId);
    await warmBuffer(env, user.id, ctx);
    return json(result);
  }
  if (path === "/api/questions/report" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        questionId: z.string().min(1).max(80),
        reason: z.string().max(1000).default("学習者が内容に疑問を感じた"),
      }),
    );
    await rate(env, `report:${user.id}`, 20);
    await reportGenerated(env, user.id, b.questionId, b.reason);
    const snapshot = await load(env, user.id);
    return json({
      overview: await refreshRanking(env, user.id, snapshot),
      instance: publicInstance(snapshot.state),
    });
  }
  if (path === "/api/provider" && req.method === "GET") {
    const p = await env.DB.prepare(
      "SELECT format,base_url,model,opencode_session FROM provider_configs WHERE user_id=?",
    )
      .bind(user.id)
      .first();
    return json({ config: p });
  }
  if (path === "/api/provider" && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM provider_configs WHERE user_id=?")
      .bind(user.id)
      .run();
    const g = await generationStatus(env, user.id);
    await configureGeneration(env, user.id, {
      enabled: 0,
      daily_limit: 0,
      verification_model: g.verificationModel,
    });
    return json({ ok: true });
  }
  if (path === "/api/provider" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        format: z.enum(["openai", "anthropic"]),
        baseUrl: z.string().max(500),
        model: z.string().min(1).max(150),
        apiKey: z.string().min(1).max(500),
        enableGeneration: z.boolean().optional(),
        opencodeSession: z
          .string()
          .trim()
          .max(200)
          .regex(/^[A-Za-z0-9._:-]*$/)
          .optional(),
      }),
    );
    if (b.enableGeneration && !env.GENERATION_QUEUE)
      fail(
        503,
        "新問生成の接続が未設定です。接続設定だけを保存することはできます。",
      );
    const base = validateBase(b.baseUrl),
      encrypted = await seal(b.apiKey, env);
    await env.DB.prepare(
      "INSERT INTO provider_configs(user_id,format,base_url,model,ciphertext,iv,opencode_session) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET format=excluded.format,base_url=excluded.base_url,model=excluded.model,ciphertext=excluded.ciphertext,iv=excluded.iv,opencode_session=excluded.opencode_session",
    )
      .bind(
        user.id,
        b.format,
        base,
        b.model,
        encrypted.ciphertext,
        encrypted.iv,
        b.opencodeSession || crypto.randomUUID(),
      )
      .run();
    await invalidatePlans(env, user.id);
    if (b.enableGeneration) {
      const current = await generationStatus(env, user.id);
      const generation = await configureGeneration(env, user.id, {
        enabled: 1,
        daily_limit: 0,
        verification_model: current.verificationModel || b.model,
      });
      return json({ ok: true, generation });
    }
    return json({ ok: true });
  }
  if (path === "/api/hint" && req.method === "POST") {
    const b = await body(
      req,
      z.object({
        instanceId: z.string().uuid(),
        message: z.string().trim().min(1).max(1000),
        ai: z.boolean(),
        requestId: z.string().uuid().optional(),
        chat: z.boolean().optional(),
        stream: z.boolean().optional(),
        stage: z.number().int().min(1).max(3).optional(),
        history: z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant"]),
                content: z.string().min(1).max(4000),
              })
              .strict(),
          )
          .max(10)
          .optional(),
      }),
    );
    if (b.chat && (!b.ai || b.stage !== 3))
      fail(400, "最後のヒントまで開いてから質問してください。");
    if (b.stream && !b.chat)
      fail(400, "ストリーミングは質問への返信で利用できます。");
    await rate(env, `hint:${user.id}`, 60);
    const { state } = await load(env, user.id, "current");
    const context = (() => {
      const s = state;
      if (!s.instance || s.instance.id !== b.instanceId)
        fail(409, "問題が切り替わりました。");
      const q = questionsFor(s).find((q) => q.id === s.instance!.questionId)!;
      const answered = s.answers.some((a) => a.instanceId === b.instanceId);
      return { q, answered };
    })();
    const deliver = async (text: string) => {
      if (!text.trim()) fail(502, "AIから有効な応答がありませんでした。");
      await mutate(
        env,
        user.id,
        (s) => {
          if (s.instance?.id !== b.instanceId)
            fail(409, "問題が切り替わりました。");
          if (!context.answered) {
            // An answer submitted while the AI was working must remain unassisted;
            // do not deliver that late hint or change the recorded answer.
            if (s.answers.some((a) => a.instanceId === b.instanceId))
              fail(409, "回答が完了しました。解説から質問してください。");
            s.instance.hint = true;
          }
          touchCourseSupport(s, s.instance.courseLesson);
        },
        "current",
      );
      return json({ text: text.slice(0, 12000) });
    };
    if (!b.ai) return await deliver(defaultHint(context.q));
    const provider = await providerFor(env, user.id);
    const fingerprint = await hash(
      JSON.stringify({
        pipeline: b.chat ? CHAT_PIPELINE_VERSION : HINT_PIPELINE_VERSION,
        instanceId: b.instanceId,
        answered: context.answered,
        chat: !!b.chat,
        message: b.chat ? b.message : "",
        history: b.chat ? (b.history ?? []) : [],
        provider,
      }),
    );
    const requestKey = b.requestId ?? fingerprint;
    await env.DB.prepare(
      "UPDATE hint_requests SET state='failed',error='処理が中断しました。同じ要求を自動再送しません。',updated_at=? WHERE user_id=? AND state='running' AND updated_at<?",
    )
      .bind(Date.now(), user.id, Date.now() - 600000)
      .run();
    const existing = await env.DB.prepare(
      "SELECT * FROM hint_requests WHERE user_id=? AND request_key=?",
    )
      .bind(user.id, requestKey)
      .first<{
        state: string;
        result: string;
        error: string;
        fingerprint: string;
      }>();
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        fail(409, "同じ要求IDで質問内容を変更できません。");
      if (existing.state === "complete") {
        const response = await deliver(existing.result);
        if (!b.stream) return response;
        return chatStream(async (send) => {
          send("delta", { text: existing.result });
          send("done", { complete: true });
        }, ctx);
      }
      fail(
        existing.state === "running" ? 409 : 502,
        existing.state === "running"
          ? "AIが処理中です。少し待ってから開いてください。"
          : existing.error,
      );
    }
    const reserved = await env.DB.prepare(
      "INSERT OR IGNORE INTO hint_requests(user_id,request_key,fingerprint,instance_id,state,created_at,updated_at) VALUES(?,?,?,?,'running',?,?)",
    )
      .bind(
        user.id,
        requestKey,
        fingerprint,
        b.instanceId,
        Date.now(),
        Date.now(),
      )
      .run();
    if (!reserved.meta.changes)
      fail(409, "AIが処理中です。少し待ってから開いてください。");
    const execute = async (
      emit?: (event: ChatProgress) => void,
      signal?: AbortSignal,
    ) => {
      try {
        let partial = "";
        const hint = b.chat
          ? await questionChat(
              env,
              provider,
              context.q,
              { message: b.message, history: b.history ?? [] },
              async (event) => {
                if ("text" in event) {
                  partial += event.text;
                  await deliver(partial);
                }
                emit?.(event);
              },
              signal,
            )
          : await questionHint(env, provider, context.q);
        await deliver(hint);
        await env.DB.prepare(
          "UPDATE hint_requests SET state='complete',result=?,updated_at=? WHERE user_id=? AND request_key=? AND state='running'",
        )
          .bind(hint, Date.now(), user.id, requestKey)
          .run();
        return hint;
      } catch (error) {
        const message =
          error instanceof HttpError
            ? error.message
            : error instanceof HintValidationError && error.issue === "format"
              ? "AIヒントの形式を整えられませんでした。もう一度作成できます。"
              : b.chat
                ? "質問への返信を確認できませんでした。もう一度送信できます。"
                : "問題に沿ったヒントを完成できませんでした。もう一度作成できます。";
        await env.DB.prepare(
          "UPDATE hint_requests SET state='failed',error=?,updated_at=? WHERE user_id=? AND request_key=? AND state='running'",
        )
          .bind(message, Date.now(), user.id, requestKey)
          .run();
        if (error instanceof HttpError) throw error;
        fail(502, message);
      }
    };
    if (b.stream)
      return chatStream(async (send, signal) => {
        await execute(
          (event) =>
            "text" in event
              ? send("delta", { text: event.text })
              : send("status", { stage: event.stage }),
          signal,
        );
        send("done", { complete: true });
      }, ctx);
    return json({ text: await execute() });
  }
  fail(404, "この操作は見つかりません。");
}
export default {
  async scheduled(_event: ScheduledController, env: Env) {
    await cleanup(env);
  },
  async queue(batch: MessageBatch<{ jobId: string }>, env: Env) {
    for (const message of batch.messages) {
      const id = message.body?.jobId;
      if (typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)) {
        await runGeneration(env, id);
        const job = await env.DB.prepare(
          "SELECT user_id,state FROM generation_jobs WHERE id=?",
        )
          .bind(id)
          .first<{ user_id: string; state: string }>();
        if (job?.state === "complete")
          await fillGenerationBuffer(env, job.user_id);
      }
      message.ack();
    }
  },
  async fetch(req: Request, env: Env, ctx?: ExecutionContext) {
    try {
      if (new URL(req.url).pathname.startsWith("/api/"))
        return secureResponse(await api(req, env, ctx));
      return secureResponse(await env.ASSETS.fetch(req));
    } catch (e) {
      if (e instanceof HttpError)
        return secureResponse(json({ error: e.message }, e.status));
      if (
        e instanceof Error &&
        [
          "科目を選択してください。",
          "別の画面でブーストを使用中です。",
          "選択肢が無効です。",
          "正解した回答を指定してください。",
          "この問題は終了しています。再読み込みしてください。",
        ].includes(e.message)
      )
        return secureResponse(json({ error: e.message }, 409));
      return secureResponse(
        json(
          {
            error:
              "処理を完了できませんでした。再読み込みしてもう一度お試しください。",
          },
          500,
        ),
      );
    }
  },
};
