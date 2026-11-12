// Fully local Workers + D1 + Queues + browser test. All LLM traffic is intercepted;
// this never calls an external provider or uses a real API key.
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MFResponse,
} from "miniflare";
import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";
import { getScheduler, schedule } from "../worker/cards.ts";
const origin = "http://localhost:8790",
  calls = [];
let serial = 0,
  failNext = false;
let releaseChat;
const chatGate = new Promise((resolve) => {
  releaseChat = resolve;
});
const chatFirst = "係数は、文字に掛かっている数を表す名前です。";
const chatSecond = "符号も含めて考えるので、負の数も係数になります。";
const bundled = await build({
  entryPoints: ["worker/index.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  charset: "utf8",
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: "127.0.0.1",
    port: 8790,
    workers: [
      {
        name: "quest-live-test",
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          APP_ORIGIN: origin,
          LOCAL_DEV: "true",
          ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
        },
        d1Databases: ["DB"],
        queueProducers: { GENERATION_QUEUE: "quest-test" },
        queueConsumers: {
          "quest-test": { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 0 },
        },
        serviceBindings: {
          ASSETS: async (req) => {
            const path = new URL(req.url).pathname;
            const root = resolve("dist");
            let file = resolve(root, "." + path);
            if (!file.startsWith(root + "/") || !extname(file))
              file = resolve(root, "index.html");
            const mime = {
              ".html": "text/html",
              ".js": "application/javascript",
              ".css": "text/css",
              ".woff2": "font/woff2",
              ".woff": "font/woff",
              ".svg": "image/svg+xml",
              ".webmanifest": "application/manifest+json",
              ".png": "image/png",
            };
            try {
              return new MFResponse(await readFile(file), {
                headers: {
                  "Content-Type":
                    mime[extname(file)] ?? "application/octet-stream",
                },
              });
            } catch {
              return new MFResponse("", { status: 404 });
            }
          },
        },
        outboundService: async (req) => {
          assert.equal(new URL(req.url).host, "mock.quest.invalid");
          const body = await req.json();
          calls.push(body);
          await new Promise((r) => setTimeout(r, 600));
          if (failNext) {
            failNext = false;
            return new MFResponse("rate limited", { status: 429 });
          }
          let value;
          const system = body.messages[0].content;
          if (body.stream) {
            const material = JSON.parse(body.messages[1].content);
            assert.equal(
              material.conversation.message,
              "係数という言葉の意味は？",
            );
            assert.equal(material.solutionForSafetyCheck, undefined);
            const encode = (value) =>
              new TextEncoder().encode(
                "data: " + JSON.stringify(value) + "\n\n",
              );
            return new MFResponse(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    encode({ choices: [{ delta: { content: chatFirst } }] }),
                  );
                  void chatGate.then(() => {
                    try {
                      controller.enqueue(
                        encode({
                          choices: [
                            {
                              delta: { content: chatSecond },
                              finish_reason: "stop",
                            },
                          ],
                        }),
                      );
                      controller.enqueue(
                        new TextEncoder().encode("data: [DONE]\n\n"),
                      );
                      controller.close();
                    } catch {}
                  });
                },
              }),
              { headers: { "Content-Type": "text/event-stream" } },
            );
          } else if (system.includes("検査器")) {
            value = {
              safe: true,
              grounded: true,
              useful: true,
              ...(system.includes("relevant") ? { relevant: true } : {}),
            };
          } else if (system.includes("問題別ヒント")) {
            const material = JSON.parse(body.messages[1].content),
              anchor = material.stem.slice(0, 12);
            value = {
              anchor,
              focus: `「${anchor}」という条件に注目して、等式の性質を使います。`,
              knowledge:
                "等式は左右が同じ値であることを表し、両辺に同じ操作をすると保たれます。",
              start:
                "問題の式を項ごとに分け、文字と数を整理するところから始めます。",
            };
          } else if (body.model === "generate-model") {
            assert.equal(body.messages.length, 22);
            assert.equal(
              body.messages.filter((m) => m.role === "assistant").length,
              10,
            );
            const prompt = body.messages.at(-1).content,
              topic = prompt.match(/単元:([^。]+)/)[1],
              difficulty = Number(prompt.match(/難度:(\d)/)[1]);
            const x = ++serial + 3;
            const variable = "xyzabcdefghijklmnpqrstuvw"[serial % 24];
            // Distinct operations keep the synthetic writer from manufacturing
            // the numeric/variable twins that the production guard rejects.
            const operation = serial % 12;
            const expressions = [
              `${variable}+2=${x + 2}`,
              `${variable}-3=${x - 3}`,
              `2${variable}=${2 * x}`,
              `\\frac{${variable}}{2}=${x / 2}`,
              `${variable}^2=${x * x}`,
              `\\sqrt{${variable}}=\\sqrt{${x}}`,
              `\\frac{1}{${variable}}=\\frac{1}{${x}}`,
              `|${variable}-${x - 2}|=2`,
              `3(${variable}-1)=${3 * (x - 1)}`,
              `\\frac{${variable}}{${variable}+1}=\\frac{${x}}{${x + 1}}`,
              `${variable}+\\frac{${variable}}{2}=${1.5 * x}`,
              `(${variable}-1)(${variable}+1)=${x * x - 1}`,
            ];
            const expression = expressions[operation];
            value = {
              subject: "math1",
              topic,
              difficulty,
              stem: `正の数 $${variable}$ について、$${expression}$ を満たすものはどれ？${operation === 7 ? ` ただし $${variable}\\ge${x - 2}$ とする。` : ""}\n\n| 注目する量 | 条件 | 使える性質 |\n|---|---|---|\n| $${variable}$ | $${expression}$ | 両辺に同じ操作を行える |`,
              options: [
                { id: "a", text: `$${x - 1}$` },
                { id: "b", text: `$${x}$` },
                { id: "c", text: `$${x + 1}$` },
                { id: "d", text: `$${x + 2}$` },
              ],
              correct: "b",
              explanation: "両辺から1を引いて求めます。",
              hints: ["等式の両辺に同じ操作をしよう。"],
              expectedSeconds: 45,
            };
          } else {
            assert.equal(body.model, "verify-model");
            const blind = JSON.parse(
              body.messages[1].content.split("\n")[0].slice("問題:".length),
            );
            assert.equal("correct" in blind, false);
            value = {
              correct: "b",
              valid: true,
              reason: "ローカルの数式チェック",
              explanation: "等式の両辺から1を引くと答えが求まります。",
              hint: "等式の両辺に同じ操作をしてみよう。",
            };
          }
          return MFResponse.json({
            choices: [{ message: { content: JSON.stringify(value) } }],
            usage: { prompt_tokens: 100, completion_tokens: 120 },
          });
        },
      },
    ],
  }),
);
await mkdir("screenshots", { recursive: true });
let browser, page, db;
try {
  await mf.ready;
  db = await mf.getD1Database("DB");
  for (const migration of [
    "0001_initial.sql",
    "0002_normalized_learning.sql",
    "0003_starter_questions.sql",
    "0004_live_generation.sql",
    "0005_opencode_session.sql",
    "0006_shared_prepared.sql",
    "0007_unlimited_generation.sql",
    "0008_security_hardening.sql",
    "0009_generation_buffer.sql",
    "0010_question_variety.sql",
    "0011_score_learning.sql",
  ]) {
    const sql = (await readFile("migrations/" + migration, "utf8"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = [];
    let current = "",
      quoted = false;
    for (let n = 0; n < sql.length; n++) {
      const ch = sql[n];
      current += ch;
      if (ch === "'") {
        if (quoted && sql[n + 1] === "'") {
          current += sql[++n];
        } else quoted = !quoted;
      }
      if (ch === ";" && !quoted) {
        if (
          /^\s*CREATE\s+TRIGGER\b/i.test(current) &&
          !/\bEND\s*;\s*$/i.test(current)
        )
          continue;
        if (current.trim()) statements.push(current.trim());
        current = "";
      }
    }
    if (current.trim()) statements.push(current.trim());
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  browser = await playwright.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? (await chromium.executablePath()),
    args: process.env.CHROMIUM_PATH
      ? ["--no-sandbox"]
      : chromium.args.filter(
          (a) =>
            !a.includes("disable-web-security") &&
            !a.includes("disable-site-isolation") &&
            !a.includes("allow-running-insecure"),
        ),
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "はじめての方：新規登録" }).click();
  await page.getByLabel("表示名").fill("リアルタイム生成テスト");
  await page.getByLabel("メールアドレス").fill("live-test@example.invalid");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("test-password-generation");
  await page
    .getByRole("button", { name: "アカウントを作成", exact: true })
    .click();
  await page.getByRole("link", { name: /開発環境用/ }).click();
  await page.getByLabel("メールアドレス").fill("live-test@example.invalid");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("test-password-generation");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("button", { name: "理系", exact: true }).click();
  await page.getByRole("button", { name: "科目を保存", exact: true }).click();
  const api = async (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const r = await fetch("/api" + path, {
          method: body === undefined ? "GET" : "POST",
          headers:
            body === undefined ? {} : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: r.status, data: await r.json() };
      },
      { path, body },
    );
  await api("/profile", { subjects: ["math1"] });
  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await page.getByLabel("モデル名", { exact: true }).fill("generate-model");
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://mock.quest.invalid/v1");
  await page
    .getByLabel("APIキー", { exact: true })
    .fill("only-a-local-test-key");
  await page
    .getByRole("button", { name: "保存して新問生成を有効にする" })
    .click();
  await page
    .getByText("APIキーを保存し、AI新問生成を有効にしました。", { exact: true })
    .waitFor();
  assert.equal((await api("/generation")).data.enabled, true);
  await page.getByLabel("検証モデル", { exact: true }).fill("verify-model");
  assert.equal(await page.getByLabel("1日の生成上限").count(), 0);
  await page.getByRole("switch", { name: "その場で新問を作る" }).check();
  await page.getByRole("button", { name: "生成設定を保存" }).click();
  await page
    .getByText("AI新問生成を有効にしました。", { exact: true })
    .waitFor();
  // Reproduce a saved key with generation disabled and an exhausted unseen bank.
  const userId = (await api("/me")).data.user.id;
  await api("/generation/config", {
    enabled: false,
    verificationModel: "verify-model",
  });
  const due = Date.now() + 86400000;
  const scheduler = await getScheduler();
  const card = (id) => ({
    ...schedule(scheduler, null, id, Date.now(), true),
    dueAt: new Date(due),
  });
  const starterQuestions = await db
    .prepare("SELECT id FROM question_catalog WHERE subject='math1'")
    .all();
  await db.batch(
    starterQuestions.results.map(({ id }) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO review_cards(user_id,question_id,due,data) VALUES(?,?,?,?)",
        )
        .bind(userId, id, due, JSON.stringify(card(id))),
    ),
  );
  await page.reload();
  await page.locator(".practice-shortcut summary").click();
  await page.getByRole("button", { name: "3問から始める" }).click();
  await page
    .getByText("今出せる問題がありません。", { exact: false })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("button", { name: "AI新問生成を有効にして続ける" })
    .click();
  await page.getByRole("heading", { name: "次の1問を、準備中。" }).waitFor();
  assert.equal((await api("/generation")).data.enabled, true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "screenshots/generation-settings-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.screenshot({
    path: "screenshots/generation-wait-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".question-stem").waitFor({ timeout: 20000 });
  let bufferStatus;
  for (let n = 0; n < 100; n++) {
    bufferStatus = (await api("/generation")).data;
    if (bufferStatus.buffer?.ready === 5) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(bufferStatus.buffer.ready, 5);
  assert.equal(await page.locator(".study-content table").count(), 1);
  const buffered = await db
    .prepare(
      "SELECT COUNT(*) n,COUNT(DISTINCT question_id) unique_questions,COUNT(DISTINCT subject||':'||topic) unique_units FROM generation_plans WHERE user_id=? AND state='ready'",
    )
    .bind(userId)
    .first();
  assert.equal(buffered.n, 5);
  assert.equal(buffered.unique_questions, 5);
  assert.equal(buffered.unique_units, 5);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM generation_jobs WHERE user_id=? AND state IN ('queued','running')",
        )
        .bind(userId)
        .first()
    ).n,
    0,
  );
  await page.getByRole("button", { name: "ヒント", exact: true }).click();
  await page
    .getByRole("button", { name: "公式・定義を見る", exact: true })
    .click();
  await page.getByRole("button", { name: "使い方を見る", exact: true }).click();
  await page
    .getByLabel("まだわからないところを質問")
    .fill("係数という言葉の意味は？");
  await page.waitForFunction(
    () =>
      !document.querySelector('.hint-panel button[type="submit"]')?.disabled,
  );
  await page.getByRole("button", { name: "質問する", exact: true }).click();
  await page.getByText(chatFirst, { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByText(chatSecond, { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "返信を停止", exact: true })
      .isVisible(),
    true,
  );
  await page.screenshot({
    path: "screenshots/chat-streaming.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "ヒントを閉じる" }).click();
  await page.getByRole("button", { name: "ヒント", exact: true }).click();
  await page.getByText(chatFirst, { exact: true }).waitFor();
  await page
    .getByLabel("まだわからないところを質問")
    .fill("次は別の例を聞きたい");
  releaseChat();
  await page.getByText(chatSecond, { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "質問する", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("まだわからないところを質問").inputValue(),
    "次は別の例を聞きたい",
  );
  assert.equal(calls.filter((b) => b.stream).length, 1);
  await page.getByRole("button", { name: "ヒントを閉じる" }).click();
  await page
    .locator(".question-details summary")
    .filter({ hasText: "AI生成" })
    .waitFor();
  const me = (await api("/me")).data;
  assert.equal("correct" in me.instance.question, false);
  const first = me.instance.id;
  const q = await db
    .prepare("SELECT data FROM question_catalog WHERE id=?")
    .bind(me.instance.questionId)
    .first();
  const right = JSON.parse(q.data).correct;
  await page
    .getByLabel("選択肢を見る前の考え")
    .fill("等式の両辺へ同じ操作を行う");
  await page.getByRole("button", { name: "考えを残して、4択で確認" }).click();
  await page
    .locator(".answer-options .option")
    .nth(me.instance.optionIds.indexOf(right))
    .click();
  await page.getByRole("heading", { name: "正解。ひとつ、奪還。" }).waitFor();
  await page.locator(".reward-gain").waitFor();
  await page.screenshot({
    path: "screenshots/ignition-correct.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".reward-shockwave")
      .evaluate((el) => getComputedStyle(el).display),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "次の1問へ" }).click();
  await page
    .locator(`.question-card:not([data-instance-id="${first}"])`)
    .waitFor({ timeout: 20000 });
  await page.waitForFunction(
    () =>
      !!document.querySelector(".recall-gate textarea") &&
      !document.querySelector(".recall-gate textarea").disabled,
  );
  let second = (await api("/me")).data.instance;
  assert.notEqual(second.id, first);
  assert.notEqual(second.questionId, me.instance.questionId);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "screenshots/generated-question-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.reload();
  if (!(await page.getByRole("button", { name: "続きから学ぶ" }).isVisible()))
    await page.locator(".practice-shortcut summary").click();
  await page.getByRole("button", { name: "続きから学ぶ" }).click();
  assert.equal((await api("/me")).data.instance.id, second.id);
  await page.locator(".question-details summary").click();
  await page.getByRole("button", { name: "問題を報告して次へ" }).click();
  await page
    .locator(`.question-card:not([data-instance-id="${second.id}"])`)
    .waitFor({ timeout: 20000 });
  const discarded = await db
    .prepare("SELECT suspended FROM question_catalog WHERE id=?")
    .bind(second.questionId)
    .first();
  assert.equal(discarded.suspended, 0);
  const reported = await db
    .prepare("SELECT COUNT(*) n FROM question_reports WHERE question_id=?")
    .bind(second.questionId)
    .first();
  assert.equal(reported.n, 1);
  const provider = await api("/provider");
  assert.equal(
    JSON.stringify(provider.data).includes("only-a-local-test-key"),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local Workers/D1/Queues pipeline, BYOK settings, live wait, blind validation, private pending question, prefetch, answer, new question, resume, personal report, no key exposure, mobile layout. External LLM calls: 0.",
  );
} catch (error) {
  console.log("Live pipeline failure. Mock LLM calls:", calls.length);
  if (db) {
    console.log(
      await db.prepare("SELECT state,error FROM generation_jobs").all(),
    );
    console.log(
      await db.prepare("SELECT state,error FROM generation_plans").all(),
    );
  }
  if (page) {
    console.log(await page.locator("body").innerText());
    await page.screenshot({
      path: "screenshots/live-failure.png",
      fullPage: true,
      animations: "disabled",
    });
  }
  throw error;
} finally {
  releaseChat();
  if (browser) await browser.close();
  await mf.dispose();
}
