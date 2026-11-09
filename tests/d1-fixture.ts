import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Env } from "../worker/security";
export function seedNewAnswers(
  f: ReturnType<typeof fixture>,
  id: string,
  count: number,
  at: number,
) {
  const insert = f.sqlite.prepare(
    "INSERT INTO answer_events(user_id,instance_id,question_id,subject,answered_at,data) VALUES(?,?,?,?,?,?)",
  );
  for (let n = 0; n < count; n++) {
    const instanceId = crypto.randomUUID();
    insert.run(
      id,
      instanceId,
      "prior-new-" + n,
      "math1",
      at + n,
      JSON.stringify({
        instanceId,
        questionId: "prior-new-" + n,
        subject: "math1",
        at: at + n,
        first: true,
        dueReview: false,
        correct: true,
        hint: false,
        difficulty: 1,
        excluded: true,
      }),
    );
  }
}
export function fixture(migrate = true) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  const queries: string[] = [];
  class Prepared {
    constructor(
      readonly sql: string,
      readonly values: any[] = [],
    ) {}
    bind(...args: any[]) {
      return new Prepared(this.sql, args);
    }
    async first(column?: string) {
      const row = sqlite.prepare(this.sql).get(...this.values);
      return row ? (column ? row[column] : row) : null;
    }
    execute() {
      queries.push(this.sql);
      const statement = sqlite.prepare(this.sql);
      let results: any[] = [],
        changes = 0;
      if (statement.columns().length) results = statement.all(...this.values);
      else changes = Number(statement.run(...this.values).changes);
      return { results, success: true, meta: { changes } };
    }
    async all() {
      return this.execute();
    }
    async run() {
      return this.execute();
    }
  }
  const DB = {
    prepare: (sql: string) => new Prepared(sql),
    batch: async (statements: Prepared[]) => {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((s) => s.execute());
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  function migrations() {
    sqlite.exec(
      readFileSync("migrations/0002_normalized_learning.sql", "utf8"),
    );
    sqlite.exec(readFileSync("migrations/0003_starter_questions.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0004_live_generation.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0005_opencode_session.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0006_shared_prepared.sql", "utf8"));
    sqlite.exec(
      readFileSync("migrations/0007_unlimited_generation.sql", "utf8"),
    );
    sqlite.exec(readFileSync("migrations/0008_security_hardening.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0009_generation_buffer.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0010_question_variety.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0011_score_learning.sql", "utf8"));
  }
  if (migrate) migrations();
  const env = {
    DB,
    APP_ORIGIN: "http://localhost:8787",
    ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    LOCAL_DEV: "true",
    ASSETS: { fetch: () => new Response("") },
  } as unknown as Env;
  function user(id = "user-1") {
    sqlite
      .prepare(
        "INSERT INTO users(id,email,name,verified,created_at) VALUES(?,?,?,1,0)",
      )
      .run(id, id + "@example.invalid", id);
    return id;
  }
  return { sqlite, env, user, migrations, queries };
}
