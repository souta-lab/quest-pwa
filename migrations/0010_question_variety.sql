ALTER TABLE generation_plans ADD COLUMN focus TEXT NOT NULL DEFAULT '';
ALTER TABLE generation_plans ADD COLUMN approach TEXT NOT NULL DEFAULT '';
ALTER TABLE generation_plans ADD COLUMN scenario TEXT NOT NULL DEFAULT '';
CREATE INDEX generation_variety ON generation_plans(user_id,subject,topic,state);
