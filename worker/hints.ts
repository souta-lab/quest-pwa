import type { Question } from "./bank";
import { lessonsFor, renderLesson } from "./hint-lessons";
// Only reviewed learning material reaches the UI; AI chooses a lesson ID, never writes an answer.
export function defaultHint(q: Pick<Question, "subject" | "topic" | "stem">) {
  return renderLesson(lessonsFor(q)[0]);
}
export function selectedHint(
  text: string,
  q: Pick<Question, "subject" | "topic" | "stem">,
) {
  const match = text.trim().match(/^\{\s*"hintId"\s*:\s*(\d{1,3})\s*\}$/);
  const index = match ? Number(match[1]) : -1,
    lessons = lessonsFor(q);
  if (index < 0 || index >= lessons.length)
    throw Error("invalid_hint_selection");
  return renderLesson(lessons[index]);
}
export function hintChoices(q: Pick<Question, "subject" | "topic" | "stem">) {
  return lessonsFor(q).map((item, hintId) => ({
    hintId,
    text: renderLesson(item),
  }));
}
