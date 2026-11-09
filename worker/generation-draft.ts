import { questionSchema } from "../scripts/question-schema";
import { fail } from "./security";
import type { Question } from "./bank";

type Scope = {
  subject: string;
  topic: string;
  difficulty: number;
  basic_range: string | null;
};
const numeric = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value)
    : value;

export function parseGenerationDraft(
  value: unknown,
  scope: Scope,
  id: string,
): Question {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(502, "作問のJSONは1問分のオブジェクトにしてください。");
  const raw = value as Record<string, any>;
  const choices = Array.isArray(raw.options)
    ? raw.options.map((option: unknown, i: number) => {
        if (typeof option === "string") return { id: "abcd"[i], text: option };
        if (!option || typeof option !== "object") return option;
        const o = option as Record<string, unknown>;
        return { ...o, id: o.id == null ? "abcd"[i] : String(o.id) };
      })
    : raw.options;
  let correct =
    typeof raw.correct === "number" ? String(raw.correct) : raw.correct;
  if (typeof correct === "string" && Array.isArray(choices)) {
    correct = correct.trim();
    if (!choices.some((o) => o?.id === correct)) {
      const matching = choices.filter(
        (o) =>
          typeof o?.id === "string" &&
          o.id.toLowerCase() === correct.toLowerCase(),
      );
      if (matching.length === 1) correct = matching[0].id;
    }
  }
  const parsed = questionSchema.safeParse({
    ...raw,
    id,
    family: id,
    version: 1,
    source: "AI生成・別呼び出しで解答チェック済み。人による校閲なし。",
    subject: raw.subject ?? scope.subject,
    topic: raw.topic ?? scope.topic,
    basicRange: raw.basicRange ?? scope.basic_range ?? undefined,
    difficulty: numeric(raw.difficulty ?? scope.difficulty),
    expectedSeconds: numeric(
      raw.expectedSeconds ?? [45, 90, 150][scope.difficulty - 1],
    ),
    options: choices,
    correct,
    // These are NEVER published. Independent verification must supply valid final
    // explanation/hint text before any INSERT; writer-only formatting is immaterial.
    explanation: "独立した解答チェックの完了後に解説を設定します。",
    hints: ["独立した解答チェックの完了後にヒントを設定します。"],
  });
  if (!parsed.success) {
    const labels: Record<string, string> = {
      subject: "科目",
      topic: "単元",
      stem: "問題文",
      options: "選択肢",
      correct: "正解ID",
      difficulty: "難度",
      expectedSeconds: "想定時間",
      basicRange: "理科基礎の範囲",
    };
    const fields = [
      ...new Set(
        parsed.error.issues.map((i) => labels[String(i.path[0])] ?? "問題全体"),
      ),
    ]
      .slice(0, 3)
      .join("・");
    fail(
      502,
      `生成された問題の形式を確認できませんでした（${fields}）。もう一度作問してください。`,
    );
  }
  return parsed.data as Question;
}
