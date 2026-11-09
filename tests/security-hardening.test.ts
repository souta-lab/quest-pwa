import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index";
import { fixture } from "./d1-fixture";
import {
  hash,
  password,
  checkPassword,
  cleanup,
  token,
  seal,
  rate,
} from "../worker/security";
import { mutate, load, nextQuestion } from "../worker/repository";
import {
  configureGeneration,
  ensurePlan,
  runGeneration,
  reportGenerated,
} from "../worker/generation";
import { bank } from "../worker/bank";
import { readFileSync } from "node:fs";

async function client(f: ReturnType<typeof fixture>, id: string) {
  const session = token();
  f.sqlite
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(await hash(session), id, Date.now() + 600000);
  return (path: string, data?: unknown, extras: Record<string, string> = {}) =>
    worker.fetch(
      new Request("http://localhost:8787/api" + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: f.env.APP_ORIGIN,
          "Content-Type": "application/json",
          Cookie: "quest_session=" + session,
          "CF-Connecting-IP": "192.0.2.10",
          ...extras,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      f.env,
    );
}

test("verification links confirm mail without replacing an existing session", async () => {
  const f = fixture(),
    victim = f.user("victim");
  const call = await client(f, victim);
  const registration = await call("/auth/register", {
    email: "attacker@example.invalid",
    password: "attacker-password",
    name: "attacker",
  });
  assert.equal(registration.status, 201);
  const { devLink } = (await registration.json()) as any;
  // Cross-site top-level GET; no original registration cookie is needed.
  const r = await worker.fetch(
    new Request(devLink, {
      headers: { Origin: "https://foreign.example.invalid" },
    }),
    f.env,
  );
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Set-Cookie"), null);
  assert.equal(((await (await call("/me")).json()) as any).user.id, victim);
  assert.equal((await worker.fetch(new Request(devLink), f.env)).status, 400);
  const attacker = f.sqlite
    .prepare("SELECT id FROM users WHERE email=?")
    .get("attacker@example.invalid")!.id;
  assert.notEqual(attacker, victim);
  f.sqlite.close();
});

async function poisonedQuestion() {
  const f = fixture(),
    id = f.user("attacker"),
    victim = f.user("victim");
  f.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await seal("fake-audit-key", f.env);
  f.sqlite
    .prepare(
      "INSERT INTO provider_configs(user_id,format,base_url,model,ciphertext,iv) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      "openai",
      "https://attacker.example.invalid/v1",
      "fake",
      encrypted.ciphertext,
      encrypted.iv,
    );
  const queued: { jobId: string }[] = [];
  f.env.GENERATION_QUEUE = {
    send: async (message: { jobId: string }) => {
      queued.push(message);
    },
  } as any;
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  await configureGeneration(f.env, id, {
    enabled: 1,
    daily_limit: 0,
    verification_model: "fake-verifier",
  });
  await ensurePlan(f.env, id, crypto.randomUUID());
  const plan = f.sqlite
    .prepare("SELECT * FROM generation_plans WHERE state='pending'")
    .get()!;
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const value =
      body.model === "fake-verifier"
        ? {
            correct: "b",
            valid: true,
            reason: "Untrusted endpoint approves itself.",
            explanation: "隔離テスト専用。誤った解答を承認した応答です。",
            hint: "数の足し算の定義に注目します。",
          }
        : {
            subject: plan.subject,
            topic: plan.topic,
            stem: "隔離監査専用：2+2を計算した値はどれか。",
            options: [
              { id: "a", text: "4" },
              { id: "b", text: "5" },
              { id: "c", text: "6" },
              { id: "d", text: "7" },
            ],
            correct: "b",
            explanation: "隔離監査専用の意図的に誤った解説です。",
            hints: ["数の足し算の定義に注目します。"],
            difficulty: plan.difficulty,
            expectedSeconds: 30,
          };
    return Response.json({
      choices: [{ message: { content: JSON.stringify(value) } }],
    });
  };
  try {
    await runGeneration(f.env, queued[0].jobId);
  } finally {
    globalThis.fetch = original;
  }
  const row = f.sqlite
    .prepare(
      "SELECT id,data,owner_user_id FROM question_catalog WHERE created_by=?",
    )
    .get(id)!;
  assert.ok(row);
  await mutate(f.env, victim, (s) => {
    s.subjects = ["math1"];
  });
  f.sqlite
    .prepare("UPDATE question_catalog SET suspended=1 WHERE id<>?")
    .run(row.id);
  await assert.rejects(
    nextQuestion(f.env, victim),
    (error: any) => error.status === 409,
  );
  assert.equal((await nextQuestion(f.env, id))!.questionId, row.id);
  return { f, id, victim, row };
}

test("untrusted provider verification cannot publish to another account", async () => {
  const { f, row } = await poisonedQuestion();
  assert.equal(row.owner_user_id, "attacker");
  const q = JSON.parse(row.data as string);
  assert.equal(q.correct, "b");
  assert.equal(q.options.find((o: any) => o.id === q.correct).text, "5");
  assert.equal(q.generation.status, "machine_checked");
  f.sqlite.close();
});
test("reports only exclude the reporting user's question", async () => {
  const { f, id, victim, row } = await poisonedQuestion();
  f.sqlite
    .prepare(
      "UPDATE question_catalog SET owner_user_id=NULL,sharing_status='approved' WHERE id=?",
    )
    .run(row.id);
  await nextQuestion(f.env, victim);
  await reportGenerated(
    f.env,
    id,
    row.id as string,
    "No objective evidence; audit-only report.",
  );
  assert.equal(
    f.sqlite
      .prepare("SELECT suspended FROM question_catalog WHERE id=?")
      .get(row.id)!.suspended,
    0,
  );
  assert.equal((await load(f.env, victim)).state.instance!.questionId, row.id);
  assert.equal((await load(f.env, id)).state.instance, null);
  await reportGenerated(f.env, id, row.id as string, "duplicate").catch(
    () => {},
  );
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) n FROM question_reports").get()!.n,
    1,
  );
  f.sqlite.close();
});
test("password reset invalidates every outstanding token and session", async () => {
  const f = fixture(),
    id = f.user(),
    call = await client(f, id),
    a = token(),
    b = token();
  f.sqlite
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .run(await password("old-password"), id);
  for (const t of [a, b])
    f.sqlite
      .prepare("INSERT INTO auth_tokens VALUES(?,?,?,?,?)")
      .run(await hash(t), id, "reset", null, Date.now() + 600000);
  assert.equal(
    (await call("/auth/reset", { token: a, password: "new-password-one" }))
      .status,
    200,
  );
  assert.equal(
    (await call("/auth/reset", { token: b, password: "new-password-two" }))
      .status,
    400,
  );
  f.sqlite.close();
});
test("rotating login emails cannot bypass the IP work limit", async () => {
  const f = fixture(),
    call = await client(f, f.user());
  for (let n = 0; n < 10; n++)
    assert.equal(
      (
        await call("/auth/login", {
          email: "one@example.invalid",
          password: "test-password",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await call("/auth/login", {
        email: "one@example.invalid",
        password: "test-password",
      })
    ).status,
    429,
  );
  for (let n = 0; n < 20; n++)
    assert.equal(
      (
        await call("/auth/login", {
          email: `different-${n}@example.invalid`,
          password: "test-password",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await call("/auth/login", {
        email: "another@example.invalid",
        password: "test-password",
      })
    ).status,
    429,
  );
  f.sqlite.close();
});
test("parallel hint replay is reserved once and completed responses are cached", async () => {
  const f = fixture(),
    id = f.user(),
    call = await client(f, id);
  f.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await seal("fake-audit-key", f.env);
  f.sqlite
    .prepare(
      "INSERT INTO provider_configs(user_id,format,base_url,model,ciphertext,iv) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      "openai",
      "https://audit.example.invalid/v1",
      "fake",
      encrypted.ciphertext,
      encrypted.iv,
    );
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  const instance = (await nextQuestion(f.env, id))!,
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string),
      m = JSON.parse(body.messages[1].content),
      anchor = m.stem.slice(0, 12);
    const result = body.messages[0].content.includes("検査器")
      ? { safe: true, grounded: true, useful: true }
      : {
          anchor,
          focus: `「${anchor}」という条件を確認します。`,
          knowledge: "数式を文字の次数ごとに整理する方法を使います。",
          start: "この問題の文字と係数を整理するところから始めます。",
        };
    return Response.json({
      choices: [{ message: { content: JSON.stringify(result) } }],
    });
  };
  try {
    const input = { instanceId: instance.id, message: "ヒント", ai: true };
    const rs = await Promise.all([call("/hint", input), call("/hint", input)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.equal(calls, 2);
    assert.equal((await call("/hint", input)).status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});
test("account boundaries block foreign notes and provider retrieval", async () => {
  const f = fixture(),
    a = f.user("a"),
    b = f.user("b"),
    callA = await client(f, a),
    callB = await client(f, b);
  await mutate(f.env, a, (s) => {
    s.subjects = ["math1"];
  });
  const q = (await nextQuestion(f.env, a))!;
  assert.equal(
    (await callB("/note", { instanceId: q.id, note: "foreign modification" }))
      .status,
    409,
  );
  f.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  assert.equal(
    (
      await callA("/provider", {
        format: "openai",
        baseUrl: "https://api.example.invalid/v1",
        model: "fake",
        apiKey: "fake-key",
      })
    ).status,
    200,
  );
  assert.equal(((await (await callB("/provider")).json()) as any).config, null);
  const own = (await (await callA("/provider")).json()) as any;
  assert.equal(own.config.apiKey, undefined);
  assert.equal(own.config.ciphertext, undefined);
  assert.equal(
    (
      await callA(
        "/provider",
        {},
        { Origin: "https://foreign.example.invalid" },
      )
    ).status,
    403,
  );
  assert.equal("correct" in q.question, false);
  assert.equal("explanation" in q.question, false);
  f.sqlite.close();
});
test("expired rate buckets are reclaimed", async () => {
  const f = fixture(),
    real = Date.now,
    at = real();
  try {
    Date.now = () => at;
    await rate(f.env, "audit", 10);
    Date.now = () => at + 1200000;
    await rate(f.env, "audit", 10);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE expires_at<?")
        .get(Date.now())!.n,
      0,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limits").get()!.n,
      1,
    );
  } finally {
    Date.now = real;
    f.sqlite.close();
  }
});

test("registration avoids public address enumeration", async () => {
  const f = fixture(),
    call = await client(f, f.user());
  assert.equal(
    (
      await call("/auth/register", {
        email: "user-1@example.invalid",
        password: "test-password",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await call("/auth/register", {
        email: "new@example.invalid",
        password: "test-password",
      })
    ).status,
    201,
  );
  f.sqlite.close();
});

test("public registration sends the same response and leaves existing credentials intact", async () => {
  const f = fixture(),
    id = f.user(),
    original = globalThis.fetch;
  f.env.APP_ORIGIN = "https://quest.example.invalid";
  f.env.RESEND_API_KEY = "fake-mail-key";
  f.env.MAIL_FROM = "QUEST <test@example.invalid>";
  const call = await client(f, id);
  let sends = 0;
  globalThis.fetch = async () => {
    sends++;
    return Response.json({ id: "mock-mail" });
  };
  try {
    const existing = await call("/auth/register", {
      email: id + "@example.invalid",
      password: "test-password",
    });
    const fresh = await call("/auth/register", {
      email: "new@example.invalid",
      password: "test-password",
    });
    assert.equal(existing.status, 201);
    assert.equal(fresh.status, 201);
    assert.deepEqual(await existing.json(), await fresh.json());
    assert.equal(sends, 2);
    assert.equal(
      f.sqlite.prepare("SELECT password_hash FROM users WHERE id=?").get(id)!
        .password_hash,
      null,
    );
    assert.equal(
      f.sqlite
        .prepare("SELECT name FROM users WHERE email=?")
        .get("new@example.invalid")!.name,
      "学習者",
    );
  } finally {
    globalThis.fetch = original;
    f.sqlite.close();
  }
});

test("concurrent reset tokens can only change the password once", async () => {
  const f = fixture(),
    id = f.user(),
    call = await client(f, id),
    a = token(),
    b = token();
  for (const t of [a, b])
    f.sqlite
      .prepare("INSERT INTO auth_tokens VALUES(?,?,?,?,?)")
      .run(await hash(t), id, "reset", null, Date.now() + 600000);
  const results = await Promise.all([
    call("/auth/reset", { token: a, password: "new-password-one" }),
    call("/auth/reset", { token: b, password: "new-password-two" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(id)!
      .n,
    0,
  );
  assert.equal(
    f.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM auth_tokens WHERE user_id=? AND kind='reset'",
      )
      .get(id)!.n,
    0,
  );
  f.sqlite.close();
});

test("successful legacy login upgrades the hash without changing the password", async () => {
  const f = fixture(),
    id = f.user(),
    call = await client(f, id);
  const encoded = await password("legacy-password", "test-salt", 100000),
    parts = encoded.split("$");
  const legacy = parts[2] + "." + parts[3];
  f.sqlite
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .run(legacy, id);
  assert.equal(await checkPassword("legacy-password", legacy), true);
  assert.equal(
    (
      await call("/auth/login", {
        email: id + "@example.invalid",
        password: "legacy-password",
      })
    ).status,
    200,
  );
  const stored = f.sqlite
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(id)!.password_hash as string;
  assert.match(stored, /^pbkdf2-sha256-hmac-v1\$100000\$/);
  assert.equal(await checkPassword("legacy-password", stored, f.env), true);
  f.sqlite.close();
});

test("reset and login work with the production PBKDF2 iteration cap", async (t) => {
  const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
  t.mock.method(
    crypto.subtle,
    "deriveBits",
    async (algorithm: any, key: any, length: any) => {
      if (algorithm.name === "PBKDF2" && algorithm.iterations > 100000)
        throw new DOMException(
          "iteration counts above 100000 are not supported",
          "NotSupportedError",
        );
      return derive(algorithm, key, length);
    },
  );
  const f = fixture(),
    id = f.user(),
    call = await client(f, id);
  try {
    f.sqlite
      .prepare("UPDATE users SET password_hash=? WHERE id=?")
      .run(await password("old-password"), id);
    const request = await call("/auth/reset-request", {
      email: id + "@example.invalid",
    });
    assert.equal(request.status, 200);
    const { devLink } = (await request.json()) as any;
    const resetToken = new URL(devLink).searchParams.get("reset");
    assert.equal(
      (
        await call("/auth/reset", {
          token: resetToken,
          password: "new-password-123",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/auth/login", {
          email: id + "@example.invalid",
          password: "old-password",
        })
      ).status,
      401,
    );
    const login = await call("/auth/login", {
      email: id + "@example.invalid",
      password: "new-password-123",
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("Set-Cookie")!, /HttpOnly/);
    assert.equal(
      (
        await call("/auth/reset", {
          token: resetToken,
          password: "another-password",
        })
      ).status,
      400,
    );
    const registered = await call("/auth/register", {
      email: "cap-test@example.invalid",
      password: "new-password-123",
    });
    assert.equal(registered.status, 201);
  } finally {
    f.sqlite.close();
  }
});

test("expiry cleanup preserves active authentication and clears old hints", async () => {
  const f = fixture(),
    id = f.user(),
    now = Date.now();
  for (const [key, expires] of [
    ["expired", now - 1],
    ["active", now + 600000],
  ] as const) {
    f.sqlite
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(key, id, expires);
    f.sqlite
      .prepare("INSERT INTO auth_tokens VALUES(?,?,?,?,?)")
      .run(key, id, "reset", null, expires);
  }
  f.sqlite
    .prepare(
      "INSERT INTO hint_requests VALUES(?,?,?,?,'running',NULL,NULL,?,?)",
    )
    .run(
      id,
      "old",
      "fingerprint",
      "instance",
      now - 172800000,
      now - 172800000,
    );
  await cleanup(f.env, now);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sessions").get()!.n, 1);
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) n FROM auth_tokens").get()!.n,
    1,
  );
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) n FROM hint_requests").get()!.n,
    0,
  );
  f.sqlite.close();
});

test("API and asset responses deny framing and MIME sniffing", async () => {
  const f = fixture();
  for (const path of ["/", "/api/health", "/api/me"]) {
    const r = await worker.fetch(
      new Request("http://localhost:8787" + path),
      f.env,
    );
    assert.equal(r.headers.get("X-Frame-Options"), "DENY");
    assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(
      r.headers.get("Content-Security-Policy")!,
      /frame-ancestors 'none'/,
    );
  }
  f.sqlite.close();
});

test("report insertion and effects roll back together on DB failure", async () => {
  const { f, id, row } = await poisonedQuestion();
  f.sqlite.exec(
    "CREATE TRIGGER fail_report_effect BEFORE UPDATE ON learning_profiles BEGIN SELECT RAISE(ABORT,'injected test failure'); END",
  );
  await assert.rejects(
    reportGenerated(f.env, id, row.id as string, "rollback test"),
  );
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) n FROM question_reports").get()!.n,
    0,
  );
  assert.equal((await load(f.env, id)).state.instance!.questionId, row.id);
  f.sqlite.close();
});

test("migration quarantines unapproved shared questions and their foreign scores", async () => {
  const f = fixture(false),
    owner = f.user("creator"),
    other = f.user("other");
  for (const file of [
    "0002_normalized_learning.sql",
    "0003_starter_questions.sql",
    "0004_live_generation.sql",
    "0005_opencode_session.sql",
    "0006_shared_prepared.sql",
    "0007_unlimited_generation.sql",
  ])
    f.sqlite.exec(readFileSync("migrations/" + file, "utf8"));
  await mutate(f.env, owner, () => {}, false);
  await mutate(f.env, other, () => {}, false);
  const q = {
    ...bank[0],
    id: "old-generated",
    generation: { status: "machine_checked" },
  };
  f.sqlite
    .prepare(
      "INSERT INTO question_catalog(id,owner_user_id,subject,topic,version,data,suspended,created_by,stem_hash) VALUES(?,NULL,?,?,1,?,0,?,?)",
    )
    .run(q.id, q.subject, q.topic, JSON.stringify(q), owner, "old-hash");
  for (const user of [owner, other])
    f.sqlite
      .prepare(
        "INSERT INTO answer_events(user_id,instance_id,question_id,subject,answered_at,data) VALUES(?,?,?,?,?,?)",
      )
      .run(
        user,
        user + "-answer",
        q.id,
        q.subject,
        Date.now(),
        JSON.stringify({ excluded: false }),
      );
  f.sqlite.exec(readFileSync("migrations/0008_security_hardening.sql", "utf8"));
  const row = f.sqlite
    .prepare(
      "SELECT owner_user_id,sharing_status FROM question_catalog WHERE id=?",
    )
    .get(q.id)!;
  assert.equal(row.owner_user_id, owner);
  assert.equal(row.sharing_status, "pending");
  assert.equal(
    JSON.parse(
      f.sqlite
        .prepare("SELECT data FROM answer_events WHERE user_id=?")
        .get(other)!.data as string,
    ).excluded,
    true,
  );
  assert.equal(
    JSON.parse(
      f.sqlite
        .prepare("SELECT data FROM answer_events WHERE user_id=?")
        .get(owner)!.data as string,
    ).excluded,
    false,
  );
  f.sqlite.close();
});
