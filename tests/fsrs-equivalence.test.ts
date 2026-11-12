import { test } from "node:test";
import assert from "node:assert/strict";
import { State, type Card } from "ts-fsrs";
import {
  getScheduler,
  lastReviewAt,
  readStoredCard,
  schedule,
  schedulerLoader,
  toQuestCard,
  type QuestCard,
  type Scheduler,
} from "../worker/cards";
import { load, mutate } from "../worker/repository";
import { forget, type Answer } from "../worker/engine";
import { bank } from "../worker/bank";
import { fixture } from "./d1-fixture";
import { legacyParameters, legacySchedule, stored } from "./legacy-fsrs";

const scheduler = await getScheduler();
const MIN = 60000,
  DAY = 86400000;
const NOW = Date.UTC(2026, 0, 15, 3, 0, 0); // 1768446000000

test("DefaultScheduler is pinned to FSRS-6 with the legacy facade's settings", () => {
  const legacy = legacyParameters();
  assert.equal(scheduler.definition.model.name, "fsrs-6");
  assert.deepEqual([...scheduler.config.weights], [...legacy.w]);
  assert.deepEqual(scheduler.config.desiredRetention, {
    1: legacy.request_retention,
    2: legacy.request_retention,
    3: legacy.request_retention,
    4: legacy.request_retention,
  });
  assert.equal(scheduler.config.enableFuzz, legacy.enable_fuzz);
  assert.equal(scheduler.config.enableShortTerm, legacy.enable_short_term);
  assert.equal(scheduler.config.maximumInterval, legacy.maximum_interval);
  assert.deepEqual(scheduler.config.learningSteps, legacy.learning_steps);
  assert.deepEqual(scheduler.config.relearningSteps, legacy.relearning_steps);
});

// Captured with the pre-migration engine (fsrs().repeat) before engine.ts was
// changed; the new path must reproduce these exact due timestamps.
const reviewCard = legacySchedule(
  legacySchedule(null, NOW - 20 * DAY, false),
  NOW - 20 * DAY + 10 * MIN,
  false,
);
const relearningCard = legacySchedule(stored(reviewCard), NOW - 5 * DAY, true);
const baseline: [string, Card | null, boolean, number][] = [
  ["fresh Again", null, true, 1768446060000], // 2026-01-15T03:01Z
  ["fresh Good", null, false, 1768446600000], // 2026-01-15T03:10Z
  ["review Again", reviewCard, true, 1768446600000], // 2026-01-15T03:10Z
  ["review Good", reviewCard, false, 1771297200000], // 2026-02-17T03:00Z
  ["relearning Again", relearningCard, true, 1768446600000], // 03:10Z
  ["relearning Good", relearningCard, false, 1768878000000], // 2026-01-20T03:00Z
];
for (const [name, card, again, due] of baseline)
  test(`equivalence: ${name} at a fixed time`, () => {
    const old = legacySchedule(card && stored(card), NOW, again);
    assert.equal(+old.due, due, "legacy API still matches the recorded value");
    // Fed the stored legacy JSON, exactly as review_cards.data holds it.
    const next = schedule(scheduler, card && stored(card), "q", NOW, again);
    assert.equal(+next.dueAt, due);
    assert.deepEqual(next, toQuestCard(stored(old), "q"));
  });

test("equivalence: random review histories match the legacy API step by step", () => {
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let run = 0; run < 150; run++) {
    let t = Date.UTC(2025, 0, 1) + Math.floor(random() * 365 * DAY);
    let old: Card | null = null,
      card: QuestCard | null = null;
    for (let step = 0; step < 20; step++) {
      const again = random() < 0.3;
      const legacyInput = old && stored(old);
      old = legacySchedule(legacyInput, t, again);
      // Alternate between continuing in the new shape and resuming from a
      // legacy-shape snapshot, as answers that straddle the deploy will.
      card = schedule(
        scheduler,
        random() < 0.5 ? legacyInput : card && stored(card),
        "q",
        t,
        again,
      );
      assert.deepEqual(card, toQuestCard(stored(old), "q"), `${run}/${step}`);
      const r = random();
      t =
        r < 0.2
          ? t + Math.floor(random() * 3600000)
          : r < 0.6
            ? +old.due
            : +old.due + Math.floor(random() * 20 * DAY);
    }
  }
});

test("conversion: old-shape JSON in gives the same due epoch and fields out", () => {
  const legacy = stored(legacySchedule(stored(reviewCard), NOW, false));
  const { card, legacy: wasLegacy } = readStoredCard(
    JSON.stringify({ ...legacy, elapsed_days: 33 }),
    "question-1",
  );
  assert.equal(wasLegacy, true);
  assert.equal(+card.dueAt, Date.parse(legacy.due as unknown as string));
  assert.equal(+card.dueAt, 1771297200000);
  assert.equal(+card.lastReviewAt!, NOW);
  assert.deepEqual(card, {
    stability: legacy.stability,
    difficulty: legacy.difficulty,
    state: State.Review,
    scheduleStatus: "review",
    dueAt: new Date(1771297200000),
    lastReviewAt: new Date(NOW),
    cardId: "question-1",
    reps: legacy.reps,
    lapses: legacy.lapses,
    scheduledDays: legacy.scheduled_days,
    learningStep: legacy.learning_steps,
  });
  // New-shape JSON round-trips unchanged and is not flagged as legacy.
  const again = readStoredCard(JSON.stringify(card), "ignored");
  assert.equal(again.legacy, false);
  assert.equal(JSON.stringify(again.card), JSON.stringify(card));
  // Status mapping and New cards without last_review.
  const fresh = toQuestCard(
    { ...stored(legacySchedule(null, NOW, true)), state: State.New },
    "n",
  );
  assert.equal(fresh.scheduleStatus, "new");
  assert.equal(
    toQuestCard({ ...legacy, state: "Relearning" }, "r").scheduleStatus,
    "learning",
  );
  assert.equal(
    toQuestCard({ ...legacy, last_review: undefined, state: State.New }, "n")
      .lastReviewAt,
    null,
  );
});

test("previousCard last review is readable from either shape", () => {
  const old = stored(reviewCard);
  assert.equal(lastReviewAt(old), Date.parse(String(old.last_review)));
  assert.equal(lastReviewAt(toQuestCard(old, "q")), +reviewCard.last_review!);
  assert.equal(lastReviewAt(null), null);
});

test("scheduler initialization is shared, and a failure is retried rather than cached", async () => {
  let calls = 0;
  const get = schedulerLoader(async () => {
    calls++;
    if (calls === 1) throw Error("init failed");
    return scheduler;
  });
  await assert.rejects(get(), /init failed/);
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a, scheduler);
  assert.equal(b, scheduler);
  assert.equal(calls, 2);
});

test("legacy rows load as the new shape, stay untouched until rescheduled, then save in the new shape", async () => {
  const f = fixture(),
    id = f.user();
  const q = bank.find((q) => q.subject === "math1")!;
  const t0 = NOW,
    t1 = NOW + 10 * MIN,
    t2 = NOW + 3 * DAY;
  const c1 = legacySchedule(null, t0, false);
  const c2 = legacySchedule(stored(c1), t1, false);
  const c3 = legacySchedule(stored(c2), t2, false);
  const event = (
    instanceId: string,
    at: number,
    previousCard: Card | null,
  ) => ({
    id: instanceId,
    instanceId,
    questionId: q.id,
    subject: q.subject,
    at,
    correct: true,
    option: q.correct,
    hint: false,
    forgot: false,
    first: !previousCard,
    dueReview: !!previousCard,
    xp: 0,
    learning: 0,
    difficulty: q.difficulty,
    topic: q.topic,
    previousCard,
    drop: false,
  });
  await mutate(f.env, id, (s) => {
    s.subjects = ["math1"];
  });
  const insertAnswer = f.sqlite.prepare(
    "INSERT INTO answer_events(user_id,instance_id,question_id,subject,answered_at,data) VALUES(?,?,?,?,?,?)",
  );
  for (const [instanceId, at, previous] of [
    ["a1", t0, null],
    ["a2", t1, c1],
    ["a3", t2, c2],
  ] as const)
    insertAnswer.run(
      id,
      instanceId,
      q.id,
      q.subject,
      at,
      JSON.stringify(event(instanceId, at, previous)),
    );
  const legacyRow = JSON.stringify(c3);
  f.sqlite
    .prepare(
      "INSERT INTO review_cards(user_id,question_id,due,data) VALUES(?,?,?,?)",
    )
    .run(id, q.id, +c3.due, legacyRow);
  const row = () =>
    f.sqlite
      .prepare("SELECT due,data FROM review_cards WHERE user_id=?")
      .get(id) as { due: number; data: string };
  const answerRow = (instanceId: string) =>
    JSON.parse(
      (
        f.sqlite
          .prepare("SELECT data FROM answer_events WHERE instance_id=?")
          .get(instanceId) as { data: string }
      ).data,
    ) as Answer;

  const { state } = await load(f.env, id);
  assert.equal(+state.cards[q.id].dueAt, +c3.due);
  assert.equal(state.cards[q.id].cardId, q.id);
  assert.equal(+state.answers[2].previousCard!.dueAt, +c2.due);
  assert.equal(+state.answers[2].previousCard!.lastReviewAt!, t1);

  // Unrelated writes do not rewrite unchanged legacy rows.
  await mutate(f.env, id, (s) => {
    s.settings.sound = false;
  });
  assert.equal(row().data, legacyRow);
  assert.equal("due" in answerRow("a2").previousCard!, true);

  // The app-level forget replays a2 (now Again) and a3 from the legacy
  // snapshot, matching the legacy replay, and saves the new shape.
  await mutate(f.env, id, (s) => forget(s, scheduler, "a2"));
  const expected = legacySchedule(
    stored(legacySchedule(stored(c1), t1, true)),
    t2,
    false,
  );
  const saved = JSON.parse(row().data);
  assert.equal(row().due, +expected.due);
  assert.equal(Date.parse(saved.dueAt), +expected.due);
  assert.equal(saved.due, undefined);
  assert.equal(saved.cardId, q.id);
  assert.deepEqual(
    toQuestCard(saved, q.id),
    toQuestCard(stored(expected), q.id),
  );
  const a2 = answerRow("a2");
  assert.equal(a2.forgot, true);
  assert.equal(Date.parse(String(a2.previousCard!.dueAt)), +c1.due);
  f.sqlite.close();
});
