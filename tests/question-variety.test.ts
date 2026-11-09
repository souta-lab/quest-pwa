import { test } from "node:test";
import assert from "node:assert/strict";
import { topics } from "../worker/curriculum";
import {
  chooseBrief,
  focusChoices,
  approaches,
  scenarios,
  scenarioChoices,
  isNumberVariant,
} from "../worker/question-variety";
import { fixture } from "./d1-fixture";
import { bank } from "../worker/bank";
import { initialState, attachBank, next } from "../worker/engine";
test("all curriculum units have at least four distinct question targets", () => {
  let count = 0;
  for (const [subject, units] of Object.entries(topics))
    for (const topic of units) {
      const choices = focusChoices(subject, topic);
      assert.ok(choices.length >= 4, subject + ":" + topic);
      assert.equal(new Set(choices).size, choices.length);
      count += choices.length;
    }
  assert.ok(count >= 300);
});
test("targets, approaches and scenarios rotate even with fixed randomness and pending plans count", async () => {
  const f = fixture(),
    id = f.user(),
    briefs: Awaited<ReturnType<typeof chooseBrief>>[] = [];
  try {
    for (let i = 0; i < 80; i++) {
      const b = await chooseBrief(f.env, id, "physics", "力学", () => 0);
      briefs.push(b);
      f.sqlite
        .prepare(
          "INSERT INTO generation_plans(id,user_id,request_id,subject,basic_ranges,topic,difficulty,state,source,created_at,focus,approach,scenario) VALUES(?,?,?,'physics','[]','力学',1,'used','generated',0,?,?,?)",
        )
        .run("v" + i, id, "r" + i, b.focus, b.approach, b.scenario);
    }
    for (const [field, options] of [
      ["focus", focusChoices("physics", "力学")],
      ["approach", approaches],
      ["scenario", scenarioChoices("physics")],
    ] as const) {
      const counts = options.map(
        (o) => briefs.filter((b) => b[field] === o).length,
      );
      assert.equal(Math.max(...counts) - Math.min(...counts), 0);
      for (let i = 1; i < briefs.length; i++)
        assert.notEqual(briefs[i][field], briefs[i - 1][field]);
    }
    assert.equal(new Set(briefs.map((b) => JSON.stringify(b))).size, 80);
  } finally {
    f.sqlite.close();
  }
});
test("contexts are appropriate to the selected subject instead of a global story loop", () => {
  assert.equal(scenarioChoices("math1"), scenarioChoices("math2"));
  assert.notDeepEqual(scenarioChoices("math1"), scenarioChoices("english"));
  assert.notDeepEqual(
    scenarioChoices("physics"),
    scenarioChoices("japanHistory"),
  );
  for (const subject of Object.keys(topics))
    assert.ok(scenarioChoices(subject).length >= 8);
  assert.ok(scenarios.length >= 8);
});
test("numeric twins are detected without conflating another condition or a knowledge question", () => {
  assert.equal(
    isNumberVariant(
      "$x+2=9$ を満たす $x$ はどれ？ 等式の性質を使って判断する。",
      "$y-3=8$ を満たす $y$ はどれ？ 等式の性質を使って判断する。",
    ),
    false,
  );
  assert.equal(
    isNumberVariant(
      "$x+1=6$ を満たす $x$ はどれ？ 数値の表を参考にして判断する。",
      "$z+3=9$ を満たす $z$ はどれ？ 数値の表を参考にして判断する。",
    ),
    true,
  );
  assert.equal(
    isNumberVariant(
      "長方形の縦が2 cm、横が3 cmのとき、面積はどれか。",
      "長方形の縦が4 cm、横が6 cmのとき、面積はどれか。",
    ),
    true,
  );
  assert.equal(
    isNumberVariant(
      "長方形の縦が2 cm、横が3 cmのとき、面積はどれか。",
      "長方形の縦が4 cm、横が6 cmのとき、周の長さはどれか。",
    ),
    false,
  );
  assert.equal(
    isNumberVariant(
      "ある出来事が起こったのは1900年である。",
      "ある出来事が起こったのは1910年である。",
    ),
    false,
  );
});
test("private target labels cannot reveal a knowledge answer in a public question", () => {
  const q = {
    ...bank[0],
    generation: {
      status: "machine_checked" as const,
      model: "test",
      verificationModel: "test",
      checkedAt: 0,
      focus: "SECRET_ANSWER_TARGET",
      approach: "SECRET_APPROACH",
      scenario: "SECRET_SCENARIO",
    },
  };
  const s = initialState();
  s.subjects = [q.subject];
  attachBank(s, [q]);
  const publicQuestion = next(s, Date.now(), () => 0);
  assert.equal(JSON.stringify(publicQuestion).includes("SECRET_"), false);
});
