import { test } from "node:test";
import assert from "node:assert/strict";
import { bank } from "../worker/bank";
import {
  initialState,
  attachBank,
  next,
  answer,
  forget,
  heartbeat,
  overview,
  eligible,
} from "../worker/engine";
const t = Date.UTC(2026, 9, 5);
function state() {
  const s = initialState(bank);
  s.subjects = ["math1", "english"];
  return s;
}
test("uniform subject sampling precedes question selection", () => {
  const s = state();
  const counts = { math1: 0, english: 0 };
  for (let i = 0; i < 4000; i++) {
    s.instance = null;
    const q = next(s, t)!;
    counts[q.question.subject as keyof typeof counts]++;
  }
  assert.ok(Math.abs(counts.math1 - counts.english) < 250);
});
test("question response never discloses answer before submission", () => {
  const s = state(),
    q = next(s, t)!;
  assert.ok(!("correct" in q.question));
  assert.ok(!("explanation" in q.question));
  assert.equal(q.question.options.length, 4);
});
test("retries award XP and drops only once", () => {
  const s = state(),
    i = next(s, t)!;
  const q = bank.find((q) => q.id === i.questionId)!;
  const r = answer(s, i.id, q.correct, t, () => 0);
  const twice = answer(s, i.id, q.correct, t, () => 0);
  assert.equal(r.id, twice.id);
  assert.equal(s.answers.length, 1);
  assert.equal(s.inventory, 1);
  assert.equal(s.xp, r.xp);
});
test("forgotten correct answer changes schedule but retains XP and combo", () => {
  const s = state(),
    i = next(s, t)!;
  const q = bank.find((q) => q.id === i.questionId)!;
  answer(s, i.id, q.correct, t, () => 1);
  const xp = s.xp,
    combo = s.combo;
  forget(s, i.id);
  assert.equal(s.xp, xp);
  assert.equal(s.combo, combo);
  assert.equal(s.cards[q.id].lapses, 0);
  assert.equal(s.answers[0].forgot, true);
  assert.ok(+new Date(s.cards[q.id].due) < t + 86400000);
});
test("unknown is Again, preserves previously awarded rewards, breaks combo", () => {
  const s = state();
  let i = next(s, t)!;
  answer(s, i.id, bank.find((q) => q.id === i.questionId)!.correct, t, () => 1);
  const xp = s.xp;
  s.instance = null;
  i = next(s, t + 100)!;
  answer(s, i.id, null, t + 100, () => 1);
  assert.equal(s.combo, 0);
  assert.ok(s.xp >= xp);
  assert.equal(s.answers[1].option, null);
});
test("hint-free bonus goes to learning, not XP", () => {
  const a = state(),
    b = state();
  const i = next(a, t, () => 0)!;
  b.instance = structuredClone(a.instance);
  b.instance!.hint = true;
  const correct = bank.find((q) => q.id === i.questionId)!.correct;
  answer(a, i.id, correct, t, () => 1);
  answer(b, i.id, correct, t, () => 1);
  assert.equal(a.xp, b.xp);
  assert.ok(a.answers[0].learning > b.answers[0].learning);
  assert.equal(overview(b, t).bySubject[0].observations, 0);
});
test("boost clocks pause, cannot be double consumed by multiple leases", () => {
  const s = state(),
    lease = crypto.randomUUID();
  s.boostRemaining = 600;
  heartbeat(s, lease, true, t);
  heartbeat(s, lease, false, t + 5000);
  assert.equal(s.boostRemaining, 595);
  heartbeat(s, lease, false, t + 3600000);
  assert.equal(s.boostRemaining, 595);
  heartbeat(s, lease, true, t + 3600010);
  assert.throws(() => heartbeat(s, crypto.randomUUID(), true, t + 3600011));
});
test("matching accumulated results do not reward number of calendar days", () => {
  const a = state();
  for (let i = 0; i < 4; i++) {
    a.instance = null;
    const inst = next(a, t + i * 1000)!;
    answer(a, inst.id, null, t + i * 1000, () => 1);
  }
  const b = attachBank(structuredClone(a), bank);
  b.answers.forEach((x, i) => (x.at = t - i * 86400000));
  assert.equal(overview(a, t + 5000).learning, overview(b, t + 5000).learning);
});
test("basic sciences stay one subject and obey chosen ranges", () => {
  const s = state();
  s.subjects = ["basicScience"];
  s.basicRanges = ["biology", "chemistry"];
  assert.equal(eligible(s).length, 2);
  for (let i = 0; i < 20; i++) {
    s.instance = null;
    assert.equal(next(s, t)!.question.subject, "basicScience");
  }
});
test("all starter questions have unique stable IDs and exactly one canonical answer", () => {
  assert.equal(new Set(bank.map((q) => q.id)).size, bank.length);
  for (const q of bank) {
    assert.equal(q.options.length, 4);
    assert.equal(q.options.filter((o) => o.id === q.correct).length, 1);
    assert.ok(q.expectedSeconds <= 180);
    assert.ok(!/[\u0000-\u0008\u000b\u000c]/.test(q.stem));
  }
});
