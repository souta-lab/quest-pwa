-- Keep up to five upcoming plans; one paid generation job per user at a time.
DROP INDEX generation_one_active;
CREATE INDEX generation_buffer_order ON generation_plans(user_id,state,created_at);
CREATE UNIQUE INDEX generation_one_job ON generation_jobs(user_id) WHERE state IN ('queued','running');
CREATE TRIGGER generation_buffer_capacity BEFORE INSERT ON generation_plans
WHEN NEW.state IN ('pending','ready','failed') AND
 (SELECT COUNT(*) FROM generation_plans WHERE user_id=NEW.user_id AND state IN ('pending','ready','failed'))>=5
BEGIN SELECT RAISE(IGNORE); END;
