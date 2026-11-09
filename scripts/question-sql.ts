import type { Question } from "../worker/bank";
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export function questionSQL(q: Question) {
  return `INSERT INTO question_catalog(id,subject,topic,basic_range,version,data) VALUES(${quote(q.id)},${quote(q.subject)},${quote(q.topic)},${q.basicRange ? quote(q.basicRange) : "NULL"},${q.version},${quote(JSON.stringify(q))});`;
}
