import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { studyContent } from "../shared/study-content";
import { StudyContent } from "../src/StudyContent";
import { foundationLesson } from "../worker/study-lessons";

test("reading material preserves paragraphs, tables, mathematical bars and code", () => {
  const source =
    "次の資料を読む。\n\n| x | $|x|$ |\n|---|---|\n| -2 | 2 |\n| 3 | 3 |\n\nどちらが大きいか。\n\n```text\nx ← 2\nx ← x + 3\n```";
  const b = studyContent(source);
  assert.deepEqual(
    b.map((b) => b.kind),
    ["paragraph", "table", "paragraph", "code"],
  );
  assert.equal(b[1].kind, "table");
  if (b[1].kind === "table") {
    assert.deepEqual(b[1].header, ["x", "$|x|$"]);
    assert.equal(b[1].rows.length, 2);
  }
  const html = renderToStaticMarkup(<StudyContent text={source} />);
  assert.match(html, /<table>/);
  assert.match(html, /<th scope="col">/);
  assert.match(html, /<pre>/);
  assert.match(html, /katex/);
});
test("malformed tables stay intact as text, and model-provided HTML cannot execute", () => {
  const malformed = "| a | b |\n|---|---|\n|1|2|3|";
  const b = studyContent(malformed);
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, "paragraph");
  const html = renderToStaticMarkup(
    <StudyContent
      text={'<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>'}
    />,
  );
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img "), false);
  assert.match(html, /&lt;img/);
});
test("a factorization exercise selects the polynomial lesson instead of an unrelated equation lesson", () => {
  const lesson = foundationLesson({
    subject: "math1",
    topic: "数と式",
    stem: "$(x+p)(x+q)$ の展開を使い、因数分解を考える。",
  });
  assert.equal(lesson.title, "展開と因数分解");
  assert.ok(lesson.example);
});
