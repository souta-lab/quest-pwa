ALTER TABLE question_catalog ADD COLUMN sharing_status TEXT NOT NULL DEFAULT 'approved';
UPDATE question_catalog SET sharing_status='pending',owner_user_id=created_by WHERE json_extract(data,'$.generation.status')='machine_checked';
DROP INDEX shared_stem;
CREATE UNIQUE INDEX isolated_stem ON question_catalog(COALESCE(owner_user_id,'shared'),stem_hash) WHERE stem_hash IS NOT NULL;
CREATE INDEX auth_expiry ON auth_tokens(expires_at);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE INDEX rate_expiry ON rate_limits(expires_at);
CREATE UNIQUE INDEX report_once ON question_reports(user_id,question_id);
CREATE TABLE hint_requests(
 user_id TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,instance_id TEXT NOT NULL,
 state TEXT NOT NULL,result TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_key)
);
CREATE UNIQUE INDEX hint_one_running ON hint_requests(user_id) WHERE state='running';
CREATE INDEX hint_expiry ON hint_requests(updated_at);
UPDATE answer_events SET data=json_set(data,'$.excluded',json('true')) WHERE question_id IN (SELECT id FROM question_catalog WHERE sharing_status='pending' AND (owner_user_id IS NULL OR owner_user_id<>answer_events.user_id));
UPDATE learning_profiles SET revision=revision+1,rating=NULL,observations=0,rank_index=0;
DELETE FROM prepared_instances WHERE question_id IN (SELECT id FROM question_catalog WHERE sharing_status='pending' AND (owner_user_id IS NULL OR owner_user_id<>prepared_instances.user_id));
DELETE FROM current_instances WHERE json_extract(data,'$.questionId') IN (SELECT id FROM question_catalog WHERE sharing_status='pending' AND (owner_user_id IS NULL OR owner_user_id<>current_instances.user_id));
UPDATE generation_plans SET state='cancelled' WHERE state='ready' AND question_id IN (SELECT id FROM question_catalog WHERE sharing_status='pending' AND (owner_user_id IS NULL OR owner_user_id<>generation_plans.user_id));
