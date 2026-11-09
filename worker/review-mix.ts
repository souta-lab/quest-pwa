import type { Env } from "./security";
import type { LearningState } from "./engine";
import { mathScopeSQL } from "./study-plan";

// Normally one retrieval after two new problems; a large due backlog alternates.
// Only cards whose FSRS due date has arrived are eligible.
export async function reviewSlot(
  env: Env,
  id: string,
  current: LearningState["instance"] = null,
  planned: boolean[] = [],
  now = Date.now(),
) {
  const profile = await env.DB.prepare(
    "SELECT data FROM learning_profiles WHERE user_id=?",
  )
    .bind(id)
    .first<{ data: string }>();
  if (!profile) return false;
  const s = JSON.parse(profile.data) as LearningState;
  const due = await env.DB.prepare(
    `SELECT COUNT(*) n FROM review_cards c JOIN question_catalog q ON q.id=c.question_id WHERE c.user_id=? AND c.due<=? AND q.suspended=0 AND q.subject IN (SELECT value FROM json_each(?)) AND (q.basic_range IS NULL OR q.basic_range IN (SELECT value FROM json_each(?))) AND ((q.owner_user_id IS NULL AND q.sharing_status='approved') OR q.owner_user_id=?) AND NOT EXISTS(SELECT 1 FROM question_reports r WHERE r.user_id=? AND r.question_id=q.id)${mathScopeSQL(s)}`,
  )
    .bind(
      id,
      now,
      JSON.stringify(s.subjects),
      JSON.stringify(s.basicRanges),
      id,
      id,
    )
    .first<{ n: number }>();
  if (!due?.n) return false;
  const rows = await env.DB.prepare(
    "SELECT instance_id,CASE WHEN json_extract(data,'$.first')=1 THEN 0 ELSE 1 END AS review FROM answer_events WHERE user_id=? ORDER BY answered_at DESC,rowid DESC LIMIT 3",
  )
    .bind(id)
    .all<{ instance_id: string; review: number }>();
  const recent = rows.results.map((r) => !!r.review);
  if (current && !rows.results.some((r) => r.instance_id === current.id))
    recent.unshift(current.dueReview);
  for (const review of planned) recent.unshift(review);
  if (!recent.length) return true;
  const gap = due.n >= 12 ? 1 : 2;
  return recent.length >= gap && recent.slice(0, gap).every((r) => !r);
}
