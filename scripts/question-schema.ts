import { z } from "zod";
import { subjects } from "../worker/catalog";
export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    subject: z.enum(subjects.map((s) => s.id) as [string, ...string[]]),
    topic: z.string().min(1),
    stem: z.string().min(5),
    options: z
      .array(
        z.object({ id: z.string().min(1).max(20), text: z.string().min(1) }),
      )
      .length(4),
    correct: z.string(),
    explanation: z.string().min(10),
    hints: z.array(z.string().min(5)).min(1).max(3),
    difficulty: z.number().int().min(1).max(3),
    expectedSeconds: z.number().int().min(15).max(180),
    family: z.string(),
    basicRange: z.enum(["biology", "chemistry", "physics", "earth"]).optional(),
    version: z.number().int().positive(),
    source: z.string().min(5),
  })
  .superRefine((q, c) => {
    if (new Set(q.options.map((o) => o.id)).size !== 4)
      c.addIssue({ code: "custom", message: "選択肢IDが重複しています" });
    if (q.options.filter((o) => o.id === q.correct).length !== 1)
      c.addIssue({
        code: "custom",
        message: "正解IDは選択肢に1つ存在する必要があります",
      });
    if (new Set(q.options.map((o) => o.text.trim())).size !== 4)
      c.addIssue({ code: "custom", message: "選択肢の文章が重複しています" });
    if (q.subject !== "basicScience" && q.basicRange)
      c.addIssue({
        code: "custom",
        message: "理科基礎以外にはbasicRangeを指定しないでください",
      });
    if (q.subject === "basicScience" && !q.basicRange)
      c.addIssue({
        code: "custom",
        message: "理科基礎の範囲を指定してください",
      });
  });
