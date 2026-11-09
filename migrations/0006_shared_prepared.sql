-- AI questions become a shared catalog. Retain creator attribution; no user data is shared.
ALTER TABLE question_catalog ADD COLUMN created_by TEXT REFERENCES users(id);
UPDATE question_catalog SET created_by=owner_user_id,owner_user_id=NULL WHERE json_extract(data,'$.generation.status')='machine_checked';
DROP INDEX generated_stem;
-- Existing duplicate stems are retained for review history. New publications check globally.
UPDATE question_catalog SET stem_hash=NULL WHERE stem_hash IS NOT NULL AND rowid NOT IN (SELECT MIN(rowid) FROM question_catalog WHERE stem_hash IS NOT NULL GROUP BY stem_hash);
CREATE UNIQUE INDEX shared_stem ON question_catalog(stem_hash) WHERE stem_hash IS NOT NULL;
CREATE INDEX shared_topic ON question_catalog(subject,topic,suspended);
CREATE INDEX report_question ON question_reports(question_id,user_id);
CREATE TABLE prepared_instances(
 user_id TEXT PRIMARY KEY REFERENCES users(id), previous_id TEXT NOT NULL,
 cohort TEXT NOT NULL, instance_id TEXT NOT NULL, question_id TEXT NOT NULL,
 data TEXT NOT NULL, plan_id TEXT, created_at INTEGER NOT NULL
);
