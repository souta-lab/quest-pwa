import {
  pickBalanced,
  subjectCounts,
  topicCounts,
  lastSelection,
} from "./variety";
import { reviewSlot } from "./review-mix";
import {
  studyReport,
  selectTarget,
  mathScopeSQL,
  canonicalTopic,
} from "./study-plan";
import { normalizeStudyGoal } from "../shared/study";
import { courseKey, COURSE_CONTENT_VERSION } from "../shared/course";
import { courseForQuestion } from "./course";
import { getPrepared, savePrepared } from "./prepared";
import type { Card } from "ts-fsrs";
import type { Question } from "./bank";
import {
  attachBank,
  questionsFor,
  attachSummary,
  initialState,
  overview,
  publicInstance,
  shuffle,
  type Answer,
  type LearningState,
} from "./engine";
import { fail, type Env } from "./security";

type Row = { data: string };
type Profile = Row & { revision: number };
export type Snapshot = {
  revision: number;
  state: LearningState;
  cards: Map<string, string>;
  answers: Map<string, string>;
  instance: string | null;
  full: boolean;
};
export function cohortKey(s: LearningState) {
  return JSON.stringify([
    s.subjects.slice().sort(),
    s.subjects.includes("basicScience") ? s.basicRanges.slice().sort() : [],
    s.generationMode ? "live" : "bank",
    s.subjects.includes("math2") ? s.studyGoal.mathOptions.slice().sort() : [],
  ]);
}
// Learning routes affect the buffer, never the ranking cohort.
export function preparationKey(s: LearningState) {
  return JSON.stringify([
    cohortKey(s),
    s.course?.active ? courseKey(s.course.active) : null,
    s.course?.active ? COURSE_CONTENT_VERSION : null,
  ]);
}
function profileData(s: LearningState) {
  const { cards, answers, instance, ...profile } = s;
  return JSON.stringify(profile);
}
// One batch gives a consistent read snapshot. Lightweight writes never read the bank or answer history.
export async function load(
  env: Env,
  id: string,
  scope: boolean | "current" = true,
): Promise<Snapshot> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO learning_profiles(user_id,data) VALUES(?,?)",
  )
    .bind(id, profileData(initialState()))
    .run();
  const full = scope === true;
  const statements = [
    env.DB.prepare(
      "SELECT revision,data FROM learning_profiles WHERE user_id=?",
    ).bind(id),
    env.DB.prepare("SELECT data FROM current_instances WHERE user_id=?").bind(
      id,
    ),
  ];
  if (full)
    statements.push(
      env.DB.prepare(
        "SELECT question_id,data FROM review_cards WHERE user_id=?",
      ).bind(id),
      env.DB.prepare(
        "SELECT instance_id,data FROM answer_events WHERE user_id=? ORDER BY answered_at,rowid",
      ).bind(id),
      env.DB.prepare(
        `SELECT CASE WHEN q.id=json_extract(i.data,'$.questionId') THEN q.data ELSE json_object('id',q.id,'subject',q.subject,'topic',q.topic,'basicRange',q.basic_range,'suspended',q.suspended=1 OR NOT COALESCE((q.owner_user_id IS NULL AND q.sharing_status='approved') OR q.owner_user_id=?,0) OR EXISTS(SELECT 1 FROM question_reports r WHERE r.user_id=? AND r.question_id=q.id)) END AS data FROM question_catalog q LEFT JOIN current_instances i ON i.user_id=? WHERE q.id=json_extract(i.data,'$.questionId') OR EXISTS(SELECT 1 FROM review_cards c WHERE c.user_id=? AND c.question_id=q.id) ORDER BY q.rowid`,
      ).bind(id),
    );
  if (full) statements[4] = statements[4].bind(id, id, id, id);
  if (scope === "current")
    statements.push(
      env.DB.prepare(
        "SELECT c.question_id,c.data FROM review_cards c JOIN current_instances i ON i.user_id=c.user_id AND c.question_id=json_extract(i.data,'$.questionId') WHERE i.user_id=?",
      ).bind(id),
      env.DB.prepare(
        "SELECT a.instance_id,a.data FROM answer_events a JOIN current_instances i ON i.user_id=a.user_id AND i.instance_id=a.instance_id WHERE i.user_id=?",
      ).bind(id),
      env.DB.prepare(
        "SELECT q.data FROM question_catalog q JOIN current_instances i ON q.id=json_extract(i.data,'$.questionId') WHERE i.user_id=?",
      ).bind(id),
    );
  const rows = await env.DB.batch(statements);
  const profile = rows[0].results[0] as Profile;
  const rawInstance = (rows[1].results[0] as Row | undefined)?.data ?? null;
  const cards = new Map<string, string>();
  const answers = new Map<string, string>();
  const state: LearningState = {
    ...initialState(),
    ...JSON.parse(profile.data),
    cards: {},
    answers: [],
    instance: rawInstance ? JSON.parse(rawInstance) : null,
  };
  state.studyGoal = normalizeStudyGoal(state.studyGoal);
  if (full || scope === "current") {
    for (const r of rows[2].results as {
      question_id: string;
      data: string;
    }[]) {
      cards.set(r.question_id, r.data);
      state.cards[r.question_id] = JSON.parse(r.data) as Card;
    }
    for (const r of rows[3].results as {
      instance_id: string;
      data: string;
    }[]) {
      answers.set(r.instance_id, r.data);
      state.answers.push(JSON.parse(r.data) as Answer);
    }
    attachBank(
      state,
      (rows[4].results as Row[]).map((r) => JSON.parse(r.data) as Question),
    );
  }
  if (full) {
    const rows = await env.DB.prepare(
      `SELECT q.subject,COUNT(*) AS total,SUM(CASE WHEN q.suspended=0 AND q.subject IN (SELECT value FROM json_each(?)) AND (q.basic_range IS NULL OR q.basic_range IN (SELECT value FROM json_each(?))) AND NOT EXISTS(SELECT 1 FROM question_reports r WHERE r.user_id=? AND r.question_id=q.id) THEN 1 ELSE 0 END) AS eligible FROM question_catalog q WHERE (q.owner_user_id IS NULL AND q.sharing_status='approved') OR q.owner_user_id=? GROUP BY q.subject`,
    )
      .bind(
        JSON.stringify(state.subjects),
        JSON.stringify(state.basicRanges),
        id,
        id,
      )
      .all<{ subject: string; total: number; eligible: number }>();
    attachSummary(state, {
      total: rows.results.reduce((n, r) => n + r.total, 0),
      eligible: rows.results.reduce((n, r) => n + r.eligible, 0),
      bySubject: Object.fromEntries(
        rows.results.map((r) => [r.subject, r.eligible]),
      ),
    });
  }
  return {
    revision: profile.revision,
    state,
    cards,
    answers,
    instance: rawInstance,
    full,
  };
}
// All child writes are conditional on this operation's CAS token. A losing concurrent
// operation writes nothing, including its rewards, review card, and answer event.
export async function commit(
  env: Env,
  id: string,
  snapshot: Snapshot,
  extra: (op: string) => D1PreparedStatement[] = () => [],
): Promise<boolean> {
  const { state: s, revision, full } = snapshot;
  if (full) s.highestRank = Math.max(s.highestRank, overview(s).rankIndex);
  const op = crypto.randomUUID();
  const guard =
    "EXISTS(SELECT 1 FROM learning_profiles WHERE user_id=? AND commit_token=?)";
  const bindGuard = [id, op];
  const checkQuestion =
    full ||
    s.instance?.questionId !==
      (snapshot.instance
        ? JSON.parse(snapshot.instance).questionId
        : undefined);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE learning_profiles SET data=?,revision=revision+1,commit_token=?,cohort=? WHERE user_id=? AND revision=? ${checkQuestion ? "AND (?='' OR EXISTS(SELECT 1 FROM question_catalog WHERE id=? AND suspended=0))" : ""}`,
    ).bind(
      profileData(s),
      op,
      cohortKey(s),
      id,
      revision,
      ...(checkQuestion
        ? [s.instance?.questionId ?? "", s.instance?.questionId ?? ""]
        : []),
    ),
  ];
  if (full) {
    const o = overview(s);
    const measured = o.bySubject.filter((x) => x.observations);
    const rating = measured.length
      ? Math.round(measured.reduce((n, x) => n + x.rating, 0) / measured.length)
      : null;
    statements.push(
      env.DB.prepare(
        "UPDATE learning_profiles SET rating=?,observations=?,rank_index=?,updated_at=? WHERE user_id=? AND commit_token=?",
      ).bind(
        rating,
        measured.reduce((n, x) => n + x.observations, 0),
        o.rankIndex,
        Date.now(),
        id,
        op,
      ),
    );
    for (const [questionId, card] of Object.entries(s.cards)) {
      const data = JSON.stringify(card);
      if (snapshot.cards.get(questionId) === data) continue;
      statements.push(
        env.DB.prepare(
          `INSERT INTO review_cards(user_id,question_id,due,data) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(user_id,question_id) DO UPDATE SET due=excluded.due,data=excluded.data`,
        ).bind(id, questionId, +new Date(card.due), data, ...bindGuard),
      );
    }
    for (const a of s.answers) {
      const data = JSON.stringify(a);
      if (snapshot.answers.get(a.instanceId) === data) continue;
      statements.push(
        env.DB.prepare(
          `INSERT INTO answer_events(user_id,instance_id,question_id,subject,answered_at,data) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(user_id,instance_id) DO UPDATE SET data=excluded.data`,
        ).bind(
          id,
          a.instanceId,
          a.questionId,
          a.subject,
          a.at,
          data,
          ...bindGuard,
        ),
      );
    }
  }
  const instance = s.instance ? JSON.stringify(s.instance) : null;
  if (instance !== snapshot.instance) {
    if (s.instance)
      statements.push(
        env.DB.prepare(
          `INSERT INTO current_instances(user_id,instance_id,data) SELECT ?,?,? WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET instance_id=excluded.instance_id,data=excluded.data`,
        ).bind(id, s.instance.id, instance, ...bindGuard),
      );
    else
      statements.push(
        env.DB.prepare(
          `DELETE FROM current_instances WHERE user_id=? AND ${guard}`,
        ).bind(id, ...bindGuard),
      );
  }
  statements.push(...extra(op));
  const results = await env.DB.batch(statements);
  return !!results[0].meta.changes;
}
export async function mutate<T>(
  env: Env,
  id: string,
  fn: (s: LearningState) => T,
  scope: boolean | "current" = true,
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await load(env, id, scope);
    const result = fn(snapshot.state);
    if (await commit(env, id, snapshot)) return result;
  }
  fail(409, "別の操作と重なりました。もう一度試してください。");
}
// Decisions use at most the latest 30 events per unit. Long histories and full
// question bodies stay in D1; answer mutations still use the complete history.
export async function loadPlanning(env: Env, id: string) {
  const { state: s } = await load(env, id, false);
  const rows = await env.DB.batch([
    env.DB.prepare(
      `SELECT data FROM (SELECT a.data,a.answered_at,a.rowid AS event_row,ROW_NUMBER() OVER(PARTITION BY a.subject,COALESCE(json_extract(a.data,'$.topic'),q.topic) ORDER BY a.answered_at DESC,a.rowid DESC) AS position FROM answer_events a LEFT JOIN question_catalog q ON q.id=a.question_id WHERE a.user_id=?) WHERE position<=30 ORDER BY answered_at,event_row`,
    ).bind(id),
    env.DB.prepare(
      "SELECT question_id,data FROM review_cards WHERE user_id=?",
    ).bind(id),
    env.DB.prepare(
      `SELECT json_object('id',q.id,'subject',q.subject,'topic',q.topic,'basicRange',q.basic_range,'suspended',q.suspended=1 OR NOT COALESCE((q.owner_user_id IS NULL AND q.sharing_status='approved') OR q.owner_user_id=?,0) OR EXISTS(SELECT 1 FROM question_reports r WHERE r.user_id=? AND r.question_id=q.id)) AS data FROM question_catalog q WHERE EXISTS(SELECT 1 FROM review_cards c WHERE c.user_id=? AND c.question_id=q.id) OR q.id=?`,
    ).bind(id, id, id, s.instance?.questionId ?? ""),
  ]);
  s.answers = (rows[0].results as Row[]).map((r) => JSON.parse(r.data));
  s.cards = Object.fromEntries(
    (rows[1].results as { question_id: string; data: string }[]).map((r) => [
      r.question_id,
      JSON.parse(r.data),
    ]),
  );
  attachBank(
    s,
    (rows[2].results as Row[]).map((r) => JSON.parse(r.data)),
  );
  return s;
}
export async function bankCount(env: Env) {
  return (await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM question_catalog",
  ).first<{ count: number }>())!.count;
}

// Choose an available unit from learning evidence; retrieve only its selected body.
export async function nextQuestion(
  env: Env,
  id: string,
  advance = false,
  now = Date.now(),
  random = Math.random,
  prepare = false,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await load(env, id, "current"),
      s = snapshot.state;
    const last = s.instance?.questionId ?? "";
    if (
      advance &&
      s.instance &&
      s.answers.some((a) => a.instanceId === s.instance!.id)
    )
      s.instance = null;
    if (prepare) {
      const cached = await getPrepared(env, id, s);
      if (cached) return cached;
    }
    if (s.instance && !prepare) return publicInstance(s);
    if (!s.subjects.length) fail(409, "科目を選択してください。");
    const learning = await loadPlanning(env, id);
    const report = studyReport(learning, questionsFor(learning), now);
    const rangeWhere = `(q.basic_range IS NULL OR q.basic_range IN (SELECT value FROM json_each(?)))`;
    const availablePool = `q.subject IN (SELECT value FROM json_each(?)) AND ${rangeWhere} AND q.suspended=0 AND ((q.owner_user_id IS NULL AND q.sharing_status='approved') OR q.owner_user_id=?) AND q.id<>? AND NOT EXISTS(SELECT 1 FROM answer_events a WHERE a.user_id=? AND a.question_id=q.id AND a.answered_at>?) AND NOT EXISTS(SELECT 1 FROM question_reports r WHERE r.user_id=? AND r.question_id=q.id)${mathScopeSQL(s)}`;
    const args = [
      JSON.stringify(s.subjects),
      JSON.stringify(s.basicRanges),
      id,
      last,
      id,
      now - 600000,
      id,
    ];
    let review = await reviewSlot(
      env,
      id,
      prepare ? s.instance : null,
      [],
      now,
    );
    const routeWhere = (r: boolean) =>
      !r && s.course?.active
        ? " AND q.subject=? AND q.topic=? AND json_extract(q.data,'$.generation.focus')=? AND json_extract(q.data,'$.generation.teachingVersion')=?"
        : "";
    const routeArgs = (r: boolean) =>
      !r && s.course?.active
        ? [
            s.course.active.subject,
            s.course.active.topic,
            s.course.active.lesson,
            COURSE_CONTENT_VERSION,
          ]
        : [];
    const getUnits = (r: boolean) =>
      env.DB.prepare(
        `SELECT DISTINCT q.subject,q.topic FROM question_catalog q WHERE ${availablePool}${routeWhere(r)} AND ${r ? "EXISTS(SELECT 1 FROM review_cards c WHERE c.user_id=? AND c.question_id=q.id AND c.due<=?)" : "NOT EXISTS(SELECT 1 FROM review_cards c WHERE c.user_id=? AND c.question_id=q.id)"}`,
      )
        .bind(...args, ...routeArgs(r), id, ...(r ? [now] : []))
        .all<{ subject: string; topic: string }>();
    const limitRoute = (rows: { subject: string; topic: string }[]) =>
      !review && s.course?.active
        ? rows.filter(
            (u) =>
              u.subject === s.course.active!.subject &&
              canonicalTopic(u.topic, u.subject) === s.course.active!.topic,
          )
        : rows;
    let available = await getUnits(review);
    available.results = limitRoute(available.results);
    if (!available.results.length) {
      review = !review;
      available = await getUnits(review);
      available.results = limitRoute(available.results);
    }
    if (!available.results.length)
      fail(
        409,
        "今出せる問題がありません。新問を生成するか、次の復習時期に再開できます。",
      );
    const planned =
      prepare &&
      s.instance &&
      !s.answers.some((a) => a.instanceId === s.instance!.id)
        ? questionsFor(s)
            .filter((q) => q.id === s.instance!.questionId)
            .map((q) => ({ subject: q.subject, topic: q.topic }))
        : [];
    let target = selectTarget(
      report,
      learning.answers,
      planned,
      available.results,
      random,
    );
    const chosen =
      available.results.find(
        (u) =>
          u.subject === target?.subject &&
          canonicalTopic(u.topic, u.subject) === target?.topic,
      ) ?? available.results[0];
    const row = await env.DB.prepare(
      `SELECT q.data FROM question_catalog q ${review ? "JOIN review_cards c ON c.question_id=q.id AND c.user_id=?" : ""} WHERE ${availablePool}${routeWhere(review)} AND ${review ? "1=1" : "q.subject=? AND q.topic=?"} AND ${review ? "c.due<=?" : "NOT EXISTS(SELECT 1 FROM review_cards c WHERE c.user_id=? AND c.question_id=q.id)"} ORDER BY ${review ? "c.due," : "abs(COALESCE(json_extract(q.data,'$.difficulty'),1)-?),"} RANDOM() LIMIT 1`,
    )
      .bind(
        ...(review ? [id] : []),
        ...args,
        ...routeArgs(review),
        ...(review ? [] : [chosen.subject, chosen.topic]),
        review ? now : id,
        ...(review ? [] : [target?.difficulty ?? 1]),
      )
      .first<Row>();
    if (!row) continue;
    const q = JSON.parse(row.data) as Question;
    if (review)
      target =
        report.units.find(
          (u) =>
            u.subject === q.subject &&
            u.topic === canonicalTopic(q.topic, q.subject),
        ) ?? target;
    const previousInstance = s.instance;
    s.instance = {
      id: crypto.randomUUID(),
      questionId: q.id,
      optionIds: shuffle(
        q.options.map((o) => o.id),
        random,
      ),
      started: now,
      hint: false,
      dueReview: review,
      study: {
        kind: review ? "review" : (target?.kind ?? "practice"),
        reason: review
          ? "復習時期が来た知識を、ヒントを閉じて思い出そう。"
          : (target?.reason ?? "別の問題で知識を確かめよう。"),
      },
      boosted: s.boostRemaining > 0,
      note: "",
      courseLesson: courseForQuestion(s, q),
    };
    s.answers = [];
    s.cards = {};
    attachBank(s, [q]);
    const result = publicInstance(s);
    if (prepare) {
      const next = { ...s };
      s.instance = previousInstance;
      const saved = await savePrepared(env, id, snapshot, next);
      if (saved) return saved;
      continue;
    }
    if (await commit(env, id, snapshot)) return result;
  }
  fail(409, "別の操作と重なりました。もう一度試してください。");
}

export async function refreshRanking(env: Env, id: string, snapshot: Snapshot) {
  const s = snapshot.state,
    o = overview(s),
    measured = o.bySubject.filter((x) => x.observations);
  const rating = measured.length
    ? Math.round(
        measured.reduce((sum, x) => sum + x.rating, 0) / measured.length,
      )
    : null;
  await env.DB.prepare(
    "UPDATE learning_profiles SET cohort=?,rating=?,observations=?,rank_index=?,updated_at=? WHERE user_id=? AND revision=?",
  )
    .bind(
      cohortKey(s),
      rating,
      measured.reduce((sum, x) => sum + x.observations, 0),
      o.rankIndex,
      Date.now(),
      id,
      snapshot.revision,
    )
    .run();
  return o;
}
