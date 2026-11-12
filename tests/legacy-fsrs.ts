// Verbatim copy of the pre-migration scheduling path (worker/engine.ts before the
// DefaultScheduler migration). Test-only: it produces genuine legacy-shape cards
// and is the reference the new path is compared against.
import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";

function hydrateCard(card: Card): Card {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}
const legacyScheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });
export function legacySchedule(card: Card | null, at: number, again: boolean) {
  return legacyScheduler.repeat(
    card ? hydrateCard(card) : createEmptyCard(new Date(at)),
    new Date(at),
  )[again ? Rating.Again : Rating.Good].card;
}
// Stored form: what JSON.stringify(card) put in review_cards.data.
export function stored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export const legacyParameters = () => legacyScheduler.parameters;
