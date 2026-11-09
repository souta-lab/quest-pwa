// Operator-only CLI: uses Cloudflare credentials on the operator's machine.
// There is deliberately no public moderation API.
import { spawnSync } from "node:child_process";
const [action, id] = process.argv.slice(2);
const database = "f8ce7651-89f2-44fe-9ac9-a6d96a5e81ff";
if (
  !["list", "show", "approve", "reject"].includes(action) ||
  (action !== "list" && (!id || !/^[A-Za-z0-9_-]{1,160}$/.test(id)))
) {
  console.error(
    "Usage: node --import tsx scripts/moderate-question.ts list|show|approve|reject [question-id]",
  );
  process.exit(1);
}
const sql =
  action === "list"
    ? "SELECT id,subject,topic,sharing_status,(SELECT COUNT(*) FROM question_reports WHERE question_id=q.id) AS reports FROM question_catalog q WHERE json_extract(data,'$.generation.status')='machine_checked' ORDER BY rowid DESC LIMIT 100"
    : action === "show"
      ? `SELECT data,sharing_status FROM question_catalog WHERE id='${id}'`
      : action === "approve"
        ? `UPDATE question_catalog SET sharing_status='approved',owner_user_id=NULL WHERE id='${id}' AND sharing_status='pending' AND suspended=0 RETURNING id,sharing_status`
        : `UPDATE question_catalog SET sharing_status='rejected',suspended=1,data=json_set(data,'$.suspended',json('true')) WHERE id='${id}' AND sharing_status='pending' RETURNING id,sharing_status`;
const result = spawnSync(
  process.env.CF_BIN ?? "cf",
  ["d1", "query", database, "--sql", sql],
  { stdio: "inherit", shell: false },
);
if (result.error) {
  console.error(
    "Cloudflare CLIを起動できませんでした。CF_BINまたはPATHを確認してください。",
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
