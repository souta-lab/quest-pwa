import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";
import { bank } from "../worker/bank.ts";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const server = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    "8787",
    "--inspector-port",
    "9230",
    "--var",
    "LOCAL_DEV:true",
    "--var",
    `ENCRYPTION_KEY:${Buffer.alloc(32, 5).toString("base64")}`,
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch("http://127.0.0.1:8787/api/health");
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
process.on("exit", () => server.kill());
delete process.env.FONTCONFIG_PATH;
await mkdir("screenshots", { recursive: true });
const browser = await playwright.launch({
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", async (r) => {
  if (r.url().includes("/api/") && r.status() >= 400 && r.status() !== 401)
    console.log("API", r.status(), await r.text());
});
const origin = "http://localhost:8787";
const email = `smoke-${Date.now()}@example.invalid`;
try {
  const initial = await page.goto(origin);
  assert.equal(initial.headers()["x-frame-options"], "DENY");
  assert.match(
    initial.headers()["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  await page.getByRole("heading", { name: "おかえりなさい。" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "screenshots/login-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "はじめての方：新規登録" }).click();
  await page.getByLabel("表示名").fill("テスト学習者");
  await page.getByLabel("メールアドレス").fill(email);
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("quest-smoke-password");
  await page
    .getByRole("button", { name: "アカウントを作成", exact: true })
    .click();
  await page.getByRole("link", { name: /開発環境用/ }).click();
  await page.getByLabel("メールアドレス").fill(email);
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("quest-smoke-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("heading", { name: /あなたの受験科目/ }).waitFor();
  await page.getByRole("button", { name: "理系", exact: true }).click();
  await page.getByRole("button", { name: "科目を保存", exact: true }).click();
  await page.getByRole("heading", { name: "その評価、覆せ。" }).waitFor();
  const checkContrast = async (selector) => {
    const results = await page.locator(selector).evaluateAll((elements) => {
      const rgb = (value) => value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      const luminance = (rgb) =>
        rgb
          .slice(0, 3)
          .map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
      return elements
        .filter((el) => el.getClientRects().length)
        .map((el) => {
          let parent = el,
            background = [255, 255, 255];
          while (parent) {
            const value = rgb(getComputedStyle(parent).backgroundColor);
            if (value.length < 4 || value[3] === 1) {
              background = value;
              break;
            }
            parent = parent.parentElement;
          }
          const light = luminance(rgb(getComputedStyle(el).color)),
            dark = luminance(background);
          return {
            label: el.textContent.trim().slice(0, 25),
            ratio:
              (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
          };
        });
    });
    assert.ok(results.length);
    for (const result of results)
      assert.ok(result.ratio >= 4.5, JSON.stringify(result));
  };
  await checkContrast(
    '.start-button,.goal-picker button[aria-pressed="true"],.study-reason,.study-hero > small,.today-card p,.study-link-card strong',
  );
  assert.ok((await page.locator(".start-button").boundingBox()).height >= 48);
  await checkContrast(
    ".study-heading h1,.study-heading h1 span,.ignition-message,.exam-countdown,.sidebar nav button.active",
  );
  const call = async (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const response = await fetch("/api" + path, {
          method: body ? "POST" : "GET",
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, data: await response.json() };
      },
      { path, body },
    );
  // Follow the new primary flow before exercising the optional mixed session.
  const selection = { subject: "math1", topic: "数と式", lesson: "等式の変形" };
  assert.equal((await call("/course/route", { selection })).status, 200);
  await page.reload();
  await page
    .getByRole("button", { name: "学習ルートを続ける", exact: true })
    .click();
  await page.getByRole("heading", { name: "知識を、つなげ。" }).waitFor();
  await page
    .getByRole("button", { name: "教材から始める", exact: true })
    .click();
  await page.locator(".course-reading .worked-example").waitFor();
  await page.screenshot({
    path: "screenshots/course-reading.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "教材を閉じて、書いてみる", exact: true })
    .click();
  assert.equal(await page.locator(".course-reading").count(), 0);
  await page.getByLabel("自分の答え", { exact: true }).fill("7");
  await page
    .getByRole("button", { name: "答えを確かめる", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "選択肢なしで、再現できた。", exact: true })
    .waitFor();
  assert.equal((await call("/me")).data.overview.course.reproduced, 1);
  assert.equal((await call("/me")).data.overview.total, 0);
  await page.setViewportSize({ width: 320, height: 780 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "screenshots/course-recall-320.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "進み具合に戻る", exact: true })
    .click();
  await page.getByRole("button", { name: "全体の地図", exact: true }).click();
  await page.locator(".course-unit-list").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "screenshots/course-map-320.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal((await call("/course/route", { selection: null })).status, 200);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(origin);
  await page.getByRole("heading", { name: "その評価、覆せ。" }).waitFor();
  assert.equal(await page.locator(".study-hero").count(), 1);
  assert.equal(await page.locator(".study-hero .start-button").count(), 1);
  await page.locator(".practice-shortcut summary").click();
  await page.getByRole("button", { name: "1問", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "1問", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "1問から始める" }).click();
  assert.equal(
    await page
      .getByRole("progressbar", { name: "今回の目安まで" })
      .getAttribute("value"),
    "0",
  );
  await page.locator(".question-stem").waitFor();
  const me = await call("/me");
  assert.equal(me.status, 200);
  const i = me.data.instance;
  assert.ok(!("correct" in i.question));
  const q = bank.find((q) => q.id === i.questionId);
  const [right, retry] = await Promise.all([
    call("/answer", { instanceId: i.id, option: q.correct }),
    call("/answer", { instanceId: i.id, option: q.correct }),
  ]);
  assert.equal(right.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(right.data.overview.xp, retry.data.overview.xp);
  assert.equal(right.data.overview.total, 1);
  await page.reload();
  if (!(await page.getByRole("button", { name: "続きから学ぶ" }).isVisible()))
    await page.locator(".practice-shortcut summary").click();
  await page.getByRole("button", { name: "続きから学ぶ" }).click();
  await page.getByRole("heading", { name: "正解。ひとつ、奪還。" }).waitFor();
  await checkContrast(
    ".result-actions > .primary,.feedback-detail,.subject-badge",
  );
  assert.equal(
    await page
      .getByRole("progressbar", { name: "今回の目安まで" })
      .getAttribute("value"),
    "1",
  );
  await page
    .getByRole("button", { name: "ここで終える", exact: true })
    .waitFor();
  assert.ok(await page.locator(".feedback-detail").isVisible());
  await page
    .getByRole("button", { name: "覚えてなかった", exact: true })
    .click();
  await page
    .getByRole("button", { name: "復習に戻しました", exact: true })
    .waitFor();
  await page.getByText("次の問題は準備済み", { exact: true }).waitFor();
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  let releaseNext;
  const nextGate = new Promise((resolve) => (releaseNext = resolve));
  await page.route("**/api/next", async (route) => {
    await nextGate;
    await route.continue();
  });
  const oldId = await page
    .locator(".question-card")
    .getAttribute("data-instance-id");
  await page
    .getByRole("button", { name: "もう1問続ける", exact: true })
    .click();
  // The next screen is visible even while its activation request has not completed.
  await page
    .locator(`.question-card:not([data-instance-id="${oldId}"])`)
    .waitFor();
  assert.equal(
    await page.getByLabel("選択肢を見る前の考え").isDisabled(),
    true,
  );
  releaseNext();
  await page.waitForFunction(
    () =>
      !!document.querySelector(".recall-gate textarea") &&
      !document.querySelector(".recall-gate textarea").disabled,
  );
  await page.unroute("**/api/next");
  assert.equal(
    await page
      .getByRole("progressbar", { name: "今回の目安まで" })
      .getAttribute("value"),
    "0",
  );
  await page.getByRole("button", { name: "メモ", exact: true }).click();
  const canvas = page.locator("canvas");
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + 30, rect.y + 35);
  await page.mouse.down();
  await page.mouse.move(rect.x + 100, rect.y + 85, { steps: 12 });
  await page.mouse.up();
  await page.getByText("保存済み", { exact: true }).waitFor();
  const note = await call("/me");
  assert.ok(note.data.instance.note.length > 10);
  let aiCalls = 0,
    releaseAI,
    aiStarted;
  const aiReady = new Promise((resolve) => {
    aiStarted = resolve;
  });
  const aiGate = new Promise((resolve) => {
    releaseAI = resolve;
  });
  await page.route("**/api/provider", (route) =>
    route.fulfill({ json: { config: { format: "openai", model: "mock" } } }),
  );
  await page.route("**/api/hint", async (route) => {
    if (!route.request().postDataJSON().ai) return route.continue();
    aiCalls++;
    if (route.request().postDataJSON().chat) {
      const body = route.request().postDataJSON();
      assert.equal(body.stage, 3);
      assert.equal(body.message, "この式の記号は何？");
      assert.ok(body.history.length >= 1);
      return route.fulfill({
        json: {
          text: "文字は数を表す記号です。係数とは、その文字に掛かっている数を指します。",
        },
      });
    }
    if (aiCalls === 1) {
      aiStarted();
      await aiGate;
      return route.fulfill({
        status: 502,
        json: {
          error:
            "問題に沿ったヒントを完成できませんでした。もう一度作成できます。",
        },
      });
    }
    assert.match(route.request().postDataJSON().requestId, /^[0-9a-f-]{36}$/);
    await route.fulfill({ json: { text: "AIの自動ヒントです。" } });
  });
  await page.getByRole("button", { name: "基礎を読む", exact: true }).click();
  await page.locator(".worked-example").waitFor();
  assert.equal((await call("/me")).data.instance.hint, true);
  await page.screenshot({
    path: "screenshots/foundation-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "例を閉じて、問題を解く" }).click();
  await page.getByRole("button", { name: "ヒント", exact: true }).click();
  await page.locator(".hint-response").waitFor();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest(".hint-panel")),
    true,
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest(".hint-panel")),
    true,
  );
  await page.getByRole("heading", { name: "着眼点", exact: true }).waitFor();
  assert.equal(await page.locator(".hint-panel textarea").count(), 0);
  assert.equal(
    await page
      .getByRole("heading", { name: "知っておくこと", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "最初の一歩", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "公式・定義を見る", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("heading", { name: "最初の一歩", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "使い方を見る", exact: true }).click();
  await page
    .getByRole("heading", { name: "知っておくこと", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "最初の一歩", exact: true })
    .waitFor();
  assert.equal(
    (await page.locator(".hint-response").innerText()).includes("思い出"),
    false,
  );
  await page.screenshot({
    path: "screenshots/hint-knowledge.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(await page.locator(".hint-panel textarea").count(), 1);
  await aiReady;
  assert.equal(aiCalls, 1);
  await page.getByRole("button", { name: "ヒントを閉じる" }).click();
  await page.getByRole("button", { name: "ヒント", exact: true }).click();
  assert.equal(aiCalls, 1);
  await page.getByText("ヒント 3 / 3", { exact: true }).waitFor();
  releaseAI();
  await page.getByRole("button", { name: "AIヒントをもう一度作る" }).waitFor();
  await page.getByText("ヒント 3 / 3", { exact: true }).waitFor();
  await page.getByRole("button", { name: "ヒントを閉じる" }).click();
  await page.getByRole("button", { name: "ヒント", exact: true }).click();
  assert.equal(aiCalls, 1);
  await page.getByRole("button", { name: "AIヒントをもう一度作る" }).click();
  await page.getByText("AIの自動ヒントです。", { exact: true }).waitFor();
  await page.getByText("ヒント 3 / 3", { exact: true }).waitFor();
  await page.getByRole("button", { name: "ヒントを閉じる" }).click();
  await page.getByRole("button", { name: "ヒント", exact: true }).click();
  await page.getByText("AIの自動ヒントです。", { exact: true }).waitFor();
  assert.equal(aiCalls, 2);
  await page
    .getByLabel("まだわからないところを質問")
    .fill("この式の記号は何？");
  await page.getByRole("button", { name: "質問する", exact: true }).click();
  await page
    .getByText(
      "文字は数を表す記号です。係数とは、その文字に掛かっている数を指します。",
      { exact: true },
    )
    .waitFor();
  assert.equal(aiCalls, 3);
  await page.getByRole("button", { name: "ヒントを閉じる" }).click();
  await page.getByRole("button", { name: "ヒント", exact: true }).click();
  await page
    .getByText(
      "文字は数を表す記号です。係数とは、その文字に掛かっている数を指します。",
      { exact: true },
    )
    .waitFor();
  assert.equal(aiCalls, 3);
  await page.getByRole("button", { name: "ヒントを閉じる" }).click();
  await page.unroute("**/api/provider");
  await page.unroute("**/api/hint");
  await page.getByRole("button", { name: "わからない · 答えを見る" }).click();
  await page
    .getByRole("heading", { name: "弱点、暴いた。次は取る。" })
    .waitFor();
  assert.ok(await page.locator(".explanation").isVisible());
  await page.getByRole("button", { name: "ここで終える", exact: true }).click();
  await page
    .getByRole("heading", { name: "2問ぶん、反撃を刻んだ。", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".summary-metrics > div")
      .first()
      .locator("b")
      .innerText(),
    "2",
  );
  await page.getByRole("button", { name: "ホームへ", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "screenshots/home-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "screenshots/home-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  if (!(await page.getByRole("button", { name: "続きから学ぶ" }).isVisible()))
    await page.locator(".practice-shortcut summary").click();
  await page.getByRole("button", { name: "続きから学ぶ" }).click();
  await page.waitForFunction(
    () =>
      !!document.querySelector(".recall-gate textarea") &&
      !document.querySelector(".recall-gate textarea").disabled,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "screenshots/quiz-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  const pending = (await call("/me")).data.instance.id;
  await page.reload();
  if (!(await page.getByRole("button", { name: "続きから学ぶ" }).isVisible()))
    await page.locator(".practice-shortcut summary").click();
  await page.getByRole("button", { name: "続きから学ぶ" }).click();
  assert.equal((await call("/me")).data.instance.id, pending);
  await page.getByRole("button", { name: "終了・成果を見る" }).click();
  await page
    .getByRole("heading", { name: "反撃の続きは、残してある。", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".summary-metrics > div")
      .first()
      .locator("b")
      .innerText(),
    "0",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".summary-icon")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.getByRole("button", { name: "成績", exact: true }).last().click();
  await page.getByRole("heading", { name: "今の位置を、確かめる。" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "screenshots/stats-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "得点を記録", exact: true }).click();
  await page
    .getByRole("textbox", { name: "教材・試験名" })
    .fill("2026本試験の確認");
  await page
    .getByRole("spinbutton", { name: "数学Ⅰ・Aの得点", exact: true })
    .fill("65");
  await page.getByRole("button", { name: "得点を保存", exact: true }).click();
  await page.locator(".exam-score strong").filter({ hasText: "65" }).waitFor();
  let progress = (await call("/me")).data.overview.study;
  assert.equal(progress.records.length, 1);
  assert.equal(progress.records[0].percent, 65);
  assert.equal(progress.records[0].complete, false);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await page
    .getByRole("spinbutton", { name: "目標得点率（%）", exact: true })
    .fill("75");
  await page
    .getByRole("spinbutton", { name: "1日の時間の目安（分）", exact: true })
    .fill("30");
  await page.getByRole("button", { name: "目標を保存", exact: true }).click();
  await page
    .getByText("目標を保存しました。次の学習に反映します。", { exact: true })
    .waitFor();
  progress = (await call("/me")).data.overview.study;
  assert.equal(progress.goal.targetPercent, 75);
  assert.equal(progress.goal.dailyMinutes, 30);
  assert.equal(progress.records.length, 1);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await checkContrast(
    ".study-goal-settings label,.subject-toggle.selected,.provider-settings > .muted,.account-settings h3",
  );
  await page.screenshot({
    path: "screenshots/settings-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const [label, heading, file, selector] of [
    [
      "アイテム",
      "加速しろ。",
      "items",
      ".boost-card h2,.boost-card p,.boost-card .button,.inventory-note",
    ],
    ["ランキング", "順番は、変えられる。", "ranking", ".empty h3,.empty p"],
    [
      "ホーム",
      "その評価、覆せ。",
      "home-narrow",
      ".study-link-card strong,.today-card p",
    ],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).last().click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.locator(".toast").count(), 0);
    await page.locator(selector).first().waitFor();
    await checkContrast(selector);
    await page.setViewportSize({ width: 320, height: 780 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      label + " at 320px",
    );
    await page.screenshot({
      path: `screenshots/${file}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: account verification, subjects, answers, retry idempotence, forgot, note sync, hints, unknown, instant prepared transition, focus UI, resume, desktop/mobile overflow, stats, worked foundation example, measured exam record, persisted study goal, goal choice, real progress and recovery, soft checkpoint, zero-work summary, focus trap, reduced motion, primary text contrast >=4.5:1, no browser errors.",
  );
} catch (e) {
  console.log("PAGE ERROR:", await page.locator("body").innerText());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "screenshots/failure.png", fullPage: true });
  throw e;
} finally {
  await browser.close();
  server.kill();
}
