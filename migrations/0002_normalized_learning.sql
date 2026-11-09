-- Keep learning_states as a read-only migration backup for v0.1 users.
CREATE TABLE learning_profiles(
 user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0,
 commit_token TEXT NOT NULL DEFAULT '', data TEXT NOT NULL,
 cohort TEXT NOT NULL DEFAULT '', rating INTEGER, observations INTEGER NOT NULL DEFAULT 0,
 rank_index INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX profile_ranking ON learning_profiles(cohort, rating DESC);
CREATE TABLE question_catalog(
 id TEXT PRIMARY KEY, subject TEXT NOT NULL, topic TEXT NOT NULL,
 basic_range TEXT, version INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE INDEX question_subject ON question_catalog(subject,basic_range);
CREATE TABLE review_cards(
 user_id TEXT NOT NULL REFERENCES users(id), question_id TEXT NOT NULL,
 due INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,question_id)
);
CREATE INDEX review_due ON review_cards(user_id,due);
CREATE TABLE answer_events(
 user_id TEXT NOT NULL REFERENCES users(id), instance_id TEXT NOT NULL,
 question_id TEXT NOT NULL, subject TEXT NOT NULL, answered_at INTEGER NOT NULL,
 data TEXT NOT NULL, PRIMARY KEY(user_id,instance_id)
);
CREATE INDEX answer_time ON answer_events(user_id,answered_at);
CREATE INDEX answer_question_time ON answer_events(user_id,question_id,answered_at);
CREATE TABLE current_instances(
 user_id TEXT PRIMARY KEY REFERENCES users(id), instance_id TEXT NOT NULL, data TEXT NOT NULL
);
INSERT INTO learning_profiles(user_id,revision,data)
 SELECT user_id,revision,json_remove(data,'$.cards','$.answers','$.instance') FROM learning_states;
INSERT INTO review_cards(user_id,question_id,due,data)
 SELECT l.user_id,c.key,CAST((julianday(json_extract(c.value,'$.due'))-2440587.5)*86400000 AS INTEGER),c.value
 FROM learning_states l,json_each(l.data,'$.cards') c;
INSERT INTO answer_events(user_id,instance_id,question_id,subject,answered_at,data)
 SELECT l.user_id,json_extract(a.value,'$.instanceId'),json_extract(a.value,'$.questionId'),
 json_extract(a.value,'$.subject'),json_extract(a.value,'$.at'),a.value
 FROM learning_states l,json_each(l.data,'$.answers') a;
INSERT INTO current_instances(user_id,instance_id,data)
 SELECT user_id,json_extract(data,'$.instance.id'),json_extract(data,'$.instance')
 FROM learning_states WHERE json_type(data,'$.instance')='object';
