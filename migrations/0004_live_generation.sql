-- Generated questions are private, immutable learning cards after validation.
ALTER TABLE question_catalog ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE question_catalog ADD COLUMN stem_hash TEXT;
ALTER TABLE question_catalog ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0;
CREATE INDEX question_owner_subject ON question_catalog(owner_user_id,subject,suspended);
CREATE UNIQUE INDEX generated_stem ON question_catalog(owner_user_id,stem_hash) WHERE stem_hash IS NOT NULL;
CREATE TABLE generation_settings(
 user_id TEXT PRIMARY KEY REFERENCES users(id), enabled INTEGER NOT NULL DEFAULT 0,
 daily_limit INTEGER NOT NULL DEFAULT 20, verification_model TEXT NOT NULL DEFAULT ''
);
CREATE TABLE generation_plans(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
 subject TEXT NOT NULL, basic_ranges TEXT NOT NULL, basic_range TEXT, topic TEXT NOT NULL,
 difficulty INTEGER NOT NULL, state TEXT NOT NULL, source TEXT NOT NULL,
 question_id TEXT, error TEXT, created_at INTEGER NOT NULL, UNIQUE(user_id,request_id)
);
CREATE UNIQUE INDEX generation_one_active ON generation_plans(user_id) WHERE state IN ('pending','ready','failed');
CREATE TABLE generation_jobs(
 id TEXT PRIMARY KEY REFERENCES generation_plans(id), user_id TEXT NOT NULL REFERENCES users(id),
 day TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
 generation_model TEXT NOT NULL, verification_model TEXT NOT NULL,
 input_tokens INTEGER, output_tokens INTEGER, error TEXT
);
CREATE INDEX generation_daily ON generation_jobs(user_id,day);
CREATE TABLE question_reports(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), question_id TEXT NOT NULL,
 reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
