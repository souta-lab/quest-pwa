import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginSession,
  recordAnswer,
  restoreSession,
  sessionProgress,
} from "../src/study-session";
const now = Date.now();
const answer = (id = "a", extra = {}) => ({
  instanceId: id,
  at: now + 100,
  xp: 3,
  first: true,
  correct: false,
  hint: false,
  forgot: false,
  option: null,
  ...extra,
});
test("a session starts at zero and unknown answers count as work without implying recall", () => {
  const s = beginSession("learner", 3, now);
  assert.equal(sessionProgress(s).percent, 0);
  const p = sessionProgress(recordAnswer(s, answer()));
  assert.equal(p.total, 1);
  assert.equal(p.done, 1);
  assert.equal(p.newQuestions, 1);
  assert.equal(p.recalled, 0);
  assert.equal(p.xp, 3);
  assert.equal(p.reached, false);
});
test("retrying or recovering an answer cannot inflate goal progress or XP", () => {
  let s = beginSession("learner", 1, now);
  s = recordAnswer(s, answer("a", { correct: true, option: "b", xp: 20 }));
  s = recordAnswer(s, answer("a", { correct: true, option: "b", xp: 20 }));
  assert.equal(sessionProgress(s).total, 1);
  assert.equal(sessionProgress(s).xp, 20);
  const restored = restoreSession(JSON.stringify(s), "learner", now + 200)!;
  assert.equal(
    sessionProgress(
      recordAnswer(
        restored,
        answer("a", { correct: true, option: "b", xp: 20 }),
      ),
    ).percent,
    100,
  );
  const restarted = { ...restored, checkpointStart: 1 };
  assert.equal(sessionProgress(restarted).percent, 0);
  assert.equal(sessionProgress(restarted).total, 1);
});
test("closed sessions and answers from before the start cannot be credited", () => {
  const s = beginSession("learner", 1, now);
  assert.equal(
    sessionProgress(recordAnswer(s, answer("old", { at: now - 1 }))).total,
    0,
  );
  assert.equal(
    sessionProgress(recordAnswer({ ...s, active: false }, answer())).total,
    0,
  );
  assert.equal(restoreSession(JSON.stringify(s), "another-account", now), null);
  assert.equal(
    restoreSession(JSON.stringify(s), "learner", now + 13 * 3600000),
    null,
  );
});
test("recall feedback only counts unassisted remembered reviews and rejects corrupt saved progress", () => {
  let s = beginSession("learner", 5, now);
  s = recordAnswer(
    s,
    answer("a", { correct: true, first: false, option: "b" }),
  );
  s = recordAnswer(
    s,
    answer("b", { correct: true, first: false, hint: true, option: "b" }),
  );
  s = recordAnswer(
    s,
    answer("c", { correct: true, first: false, forgot: true, option: "b" }),
  );
  assert.equal(sessionProgress(s).recalled, 1);
  s = recordAnswer(
    s,
    answer("a", { correct: true, first: false, forgot: true, option: "b" }),
  );
  assert.equal(sessionProgress(s).recalled, 0);
  assert.equal(
    restoreSession(
      JSON.stringify({ ...s, checkpointStart: 999 }),
      "learner",
      now + 200,
    ),
    null,
  );
  assert.equal(
    restoreSession(
      JSON.stringify({ ...s, answers: [s.answers[0], s.answers[0]] }),
      "learner",
      now + 200,
    ),
    null,
  );
});
