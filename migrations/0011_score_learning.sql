-- Existing profiles/events keep their JSON and are hydrated with v0.5 defaults.
ALTER TABLE generation_plans ADD COLUMN purpose TEXT NOT NULL DEFAULT 'practice';
ALTER TABLE generation_plans ADD COLUMN study_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX review_due_user ON review_cards(user_id,due,question_id);
