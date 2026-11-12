import {
  DefaultScheduler,
  Rating,
  State,
  type DefaultSchedulerCard,
  type DefaultSchedulerOptions,
} from "ts-fsrs";

// Scheduler settings are pinned explicitly so a library default change (most
// importantly the FSRS-7 default model) cannot silently move due dates. These
// match what the legacy `fsrs({ request_retention: 0.9, enable_fuzz: false })`
// facade used; tests/fsrs-equivalence.test.ts checks the two stay identical.
export const SCHEDULER_OPTIONS = {
  version: "FSRS-6",
  desiredRetention: 0.9,
  enableFuzz: false,
  enableShortTerm: true,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  maximumInterval: 36500,
  graduatingInterval: 1,
  allowModelOverride: false,
} as const satisfies DefaultSchedulerOptions<"FSRS-6">;

export type Scheduler = DefaultScheduler<"FSRS-6">;
export type QuestCard = DefaultSchedulerCard<"FSRS-6">;

// Stored before the DefaultScheduler migration (legacy ts-fsrs Card JSON).
export type LegacyCard = {
  due: string | number | Date;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State | keyof typeof State;
  last_review?: string | number | Date | null;
  elapsed_days?: number;
};
export type StoredCard = QuestCard | LegacyCard;

// One initialization per isolate, shared by concurrent requests. A failed
// attempt is dropped so the next request retries instead of caching the
// rejection forever. Callers await this before repository.mutate(), so a
// failure aborts the request before anything is written.
export function schedulerLoader(create: () => Promise<Scheduler>) {
  let pending: Promise<Scheduler> | null = null;
  return (): Promise<Scheduler> =>
    (pending ??= create().catch((error) => {
      pending = null;
      throw error;
    }));
}
export const getScheduler = schedulerLoader(() =>
  DefaultScheduler(SCHEDULER_OPTIONS),
);

export function isLegacy(card: StoredCard): card is LegacyCard {
  return !("dueAt" in card);
}
function stateOf(state: LegacyCard["state"]): State {
  return typeof state === "number" ? state : State[state];
}
function statusOf(state: State): QuestCard["scheduleStatus"] {
  if (state === State.New) return "new";
  if (state === State.Review) return "review";
  return "learning";
}

// Read boundary: accepts either stored shape (or an already-hydrated card) and
// returns the DefaultScheduler shape with Date fields. The app question ID is
// the stable cardId.
export function toQuestCard(card: StoredCard, cardId: string): QuestCard {
  if (!isLegacy(card))
    return {
      ...card,
      dueAt: new Date(card.dueAt),
      lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null,
    };
  const state = stateOf(card.state);
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    state,
    scheduleStatus: statusOf(state),
    dueAt: new Date(card.due),
    lastReviewAt:
      state !== State.New && card.last_review
        ? new Date(card.last_review)
        : null,
    cardId,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduled_days,
    learningStep: card.learning_steps,
  };
}
export function readStoredCard(raw: string, cardId: string) {
  const parsed = JSON.parse(raw) as StoredCard;
  return { card: toQuestCard(parsed, cardId), legacy: isLegacy(parsed) };
}

// Either shape; used by reports that read old answer_events snapshots.
export function lastReviewAt(card: StoredCard | null | undefined) {
  if (!card) return null;
  const at = isLegacy(card) ? card.last_review : card.lastReviewAt;
  return at ? +new Date(at) : null;
}

export function schedule(
  scheduler: Scheduler,
  card: StoredCard | null,
  cardId: string,
  at: number,
  again: boolean,
): QuestCard {
  const now = new Date(at);
  return scheduler.review({
    card: card ? toQuestCard(card, cardId) : scheduler.newCard({ cardId, now }),
    grade: again ? Rating.Again : Rating.Good,
    now,
  }).card;
}
