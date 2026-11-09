import type { Env } from "./security";
// Least-seen subjects form a random shuffle bag; current unanswered question counts too.
export function pickBalanced<T extends string>(
  choices: T[],
  counts: Record<string, number>,
  random = Math.random,
  previous?: T,
): T {
  const least = Math.min(...choices.map((x) => counts[x] ?? 0));
  let candidates = choices.filter((x) => (counts[x] ?? 0) === least);
  if (candidates.length > 1 && previous)
    candidates = candidates.filter((x) => x !== previous);
  return candidates[
    Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
  ];
}
export async function lastSelection(env: Env, id: string, planned = false) {
  if (planned) {
    const row = await env.DB.prepare(
      "SELECT subject,topic FROM generation_plans WHERE user_id=? AND state IN ('ready','pending') ORDER BY rowid DESC LIMIT 1",
    )
      .bind(id)
      .first<{ subject: string; topic: string }>();
    if (row) return row;
  }
  return await env.DB.prepare(
    "SELECT q.subject,q.topic FROM current_instances i JOIN question_catalog q ON q.id=json_extract(i.data,'$.questionId') WHERE i.user_id=?",
  )
    .bind(id)
    .first<{ subject: string; topic: string }>();
}
export async function subjectCounts(env: Env, id: string, planned = false) {
  const rows = await env.DB.prepare(
    `SELECT subject,COUNT(*) AS n FROM (
      SELECT subject FROM answer_events WHERE user_id=?
      UNION ALL SELECT q.subject FROM current_instances i JOIN question_catalog q ON q.id=json_extract(i.data,'$.questionId')
      WHERE i.user_id=? AND NOT EXISTS(SELECT 1 FROM answer_events a WHERE a.user_id=i.user_id AND a.instance_id=i.instance_id)
      ${planned ? "UNION ALL SELECT subject FROM generation_plans WHERE user_id=? AND state IN ('pending','ready')" : ""}
    ) GROUP BY subject`,
  )
    .bind(id, id, ...(planned ? [id] : []))
    .all<{ subject: string; n: number }>();
  return Object.fromEntries(rows.results.map((x) => [x.subject, x.n]));
}
export async function topicCounts(
  env: Env,
  id: string,
  subject: string,
  planned = false,
) {
  const rows = await env.DB.prepare(
    `SELECT topic,COUNT(*) AS n FROM (
      SELECT q.topic FROM answer_events a JOIN question_catalog q ON q.id=a.question_id WHERE a.user_id=? AND q.subject=?
      UNION ALL SELECT q.topic FROM current_instances i JOIN question_catalog q ON q.id=json_extract(i.data,'$.questionId')
      WHERE i.user_id=? AND q.subject=? AND NOT EXISTS(SELECT 1 FROM answer_events a WHERE a.user_id=i.user_id AND a.instance_id=i.instance_id)
      ${planned ? "UNION ALL SELECT topic FROM generation_plans WHERE user_id=? AND subject=? AND state IN ('pending','ready')" : ""}
    ) GROUP BY topic`,
  )
    .bind(id, subject, id, subject, ...(planned ? [id, subject] : []))
    .all<{ topic: string; n: number }>();
  return Object.fromEntries(rows.results.map((x) => [x.topic, x.n]));
}
