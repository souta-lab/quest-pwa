import { load, commit, preparationKey, type Snapshot } from "./repository";
import { attachBank, publicInstance, type LearningState } from "./engine";
import { fail, type Env } from "./security";
import type { Question } from "./bank";
import { reviewSlot } from "./review-mix";
type Row = {
  previous_id: string;
  cohort: string;
  instance_id: string;
  question_id: string;
  data: string;
  plan_id: string | null;
  question: string;
};
async function row(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT p.*,q.data AS question FROM prepared_instances p JOIN question_catalog q ON q.id=p.question_id
    WHERE p.user_id=? AND q.suspended=0 AND ((q.owner_user_id IS NULL AND q.sharing_status='approved') OR q.owner_user_id=p.user_id) AND NOT EXISTS(SELECT 1 FROM question_reports r WHERE r.user_id=p.user_id AND r.question_id=q.id) AND NOT EXISTS(SELECT 1 FROM answer_events a WHERE a.user_id=p.user_id AND a.question_id=p.question_id AND a.answered_at>?) AND NOT EXISTS(SELECT 1 FROM review_cards c WHERE c.user_id=p.user_id AND c.question_id=p.question_id AND c.due>?) AND NOT EXISTS(SELECT 1 FROM current_instances i WHERE i.user_id=p.user_id AND json_extract(i.data,'$.questionId')=p.question_id) AND (p.plan_id IS NULL OR EXISTS(SELECT 1 FROM generation_plans g WHERE g.id=p.plan_id AND g.state='ready'))`,
  )
    .bind(id, Date.now() - 600000, Date.now())
    .first<Row>();
}
function matches(r: Row, s: LearningState) {
  return (
    r.previous_id === (s.instance?.id ?? "") && r.cohort === preparationKey(s)
  );
}
function display(r: Row, s: LearningState) {
  const copy = { ...s, instance: JSON.parse(r.data), answers: [], cards: {} };
  attachBank(copy, [JSON.parse(r.question)]);
  return publicInstance(copy);
}
export async function getPrepared(env: Env, id: string, s: LearningState) {
  const r = await row(env, id);
  if (
    r &&
    matches(r, s) &&
    (!JSON.parse(r.data).dueReview || (await reviewSlot(env, id, s.instance)))
  )
    return display(r, s);
  await env.DB.prepare(
    "DELETE FROM prepared_instances WHERE user_id=? AND previous_id=?",
  )
    .bind(id, s.instance?.id ?? "")
    .run();
  return null;
}
export async function savePrepared(
  env: Env,
  id: string,
  snapshot: Snapshot,
  next: LearningState,
  planId: string | null = null,
) {
  const previous = snapshot.state.instance?.id ?? "",
    cohort = preparationKey(snapshot.state);
  await env.DB.prepare(
    `INSERT INTO prepared_instances(user_id,previous_id,cohort,instance_id,question_id,data,plan_id,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM learning_profiles WHERE user_id=? AND revision=?)
    ON CONFLICT(user_id) DO UPDATE SET previous_id=excluded.previous_id,cohort=excluded.cohort,instance_id=excluded.instance_id,question_id=excluded.question_id,data=excluded.data,plan_id=excluded.plan_id,created_at=excluded.created_at
    WHERE prepared_instances.previous_id<>excluded.previous_id OR prepared_instances.cohort<>excluded.cohort
      OR NOT EXISTS(SELECT 1 FROM question_catalog q WHERE q.id=prepared_instances.question_id AND q.suspended=0)
      OR (prepared_instances.plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM generation_plans g WHERE g.id=prepared_instances.plan_id AND g.state='ready'))`,
  )
    .bind(
      id,
      previous,
      cohort,
      next.instance!.id,
      next.instance!.questionId,
      JSON.stringify(next.instance),
      planId,
      Date.now(),
      id,
      snapshot.revision,
    )
    .run();
  return getPrepared(env, id, snapshot.state);
}
export async function promotePrepared(
  env: Env,
  id: string,
  preparedId: string,
  previousId: string,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await load(env, id, "current"),
      s = snapshot.state;
    if (s.instance?.id === preparedId) return publicInstance(s); // replay after lost response
    const r = await row(env, id);
    if (
      !r ||
      r.instance_id !== preparedId ||
      r.previous_id !== previousId ||
      !matches(r, s) ||
      (JSON.parse(r.data).dueReview && !(await reviewSlot(env, id, s.instance)))
    )
      fail(409, "次の問題を準備し直します。");
    if (s.instance && !s.answers.some((a) => a.instanceId === s.instance!.id))
      fail(409, "現在の問題に回答してください。");
    s.instance = {
      ...JSON.parse(r.data),
      started: Date.now(),
      boosted: s.boostRemaining > 0,
    };
    s.answers = [];
    s.cards = {};
    attachBank(s, [JSON.parse(r.question) as Question]);
    if (
      await commit(env, id, snapshot, (op) => [
        env.DB.prepare(
          "DELETE FROM prepared_instances WHERE user_id=? AND instance_id=? AND EXISTS(SELECT 1 FROM learning_profiles WHERE user_id=? AND commit_token=?)",
        ).bind(id, preparedId, id, op),
        ...(r.plan_id
          ? [
              env.DB.prepare(
                "UPDATE generation_plans SET state='used' WHERE id=? AND state='ready' AND EXISTS(SELECT 1 FROM learning_profiles WHERE user_id=? AND commit_token=?)",
              ).bind(r.plan_id, id, op),
            ]
          : []),
      ])
    )
      return publicInstance(s);
  }
  fail(409, "別の操作と重なりました。再読み込みしてください。");
}
