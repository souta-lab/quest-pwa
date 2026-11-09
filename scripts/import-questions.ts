import { readFile, writeFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { questionSchema } from "./question-schema";
import { bank } from "../worker/bank";
import { questionSQL } from "./question-sql";
const path = process.argv[2];
if (!path || !process.argv.includes("--approved"))
  throw Error(
    "Usage: npm run import:questions -- approved.json --approved。根拠・正解・解説を確認したquestion配列のみ取り込んでください。",
  );
const qs = z
  .array(questionSchema)
  .parse(JSON.parse(await readFile(path, "utf8")));
const ids = new Set(bank.map((q) => q.id));
const stems = new Set(bank.map((q) => q.stem.trim()));
for (const q of qs) {
  if (ids.has(q.id) || stems.has(q.stem.trim()))
    throw Error(`IDまたは問題文が重複: ${q.id}`);
  ids.add(q.id);
  stems.add(q.stem.trim());
}
if (!qs.length) throw Error("問題が空です。");
const migrations = await readdir("migrations");
const number =
  Math.max(
    ...migrations
      .map((name) => Number(name.split("_")[0]))
      .filter(Number.isFinite),
  ) + 1;
const migration = `migrations/${String(number).padStart(4, "0")}_import_questions.sql`;
await writeFile(
  migration,
  "-- Approved original questions. Apply with db:migrate before serving.\n" +
    qs.map(questionSQL).join("\n") +
    "\n",
  { flag: "wx" },
);
const existing = JSON.parse(
  await readFile("worker/generated-bank.json", "utf8"),
);
await writeFile(
  "worker/generated-bank.json",
  JSON.stringify([...existing, ...qs], null, 2) + "\n",
);
console.log(
  `${qs.length}問の移行ファイルを作成: ${migration}。npm run db:migrate でローカルに反映。公開DBは wrangler d1 migrations apply DB --remote。`,
);
