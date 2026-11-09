CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT, google_sub TEXT UNIQUE, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT,kind TEXT NOT NULL,payload TEXT,expires_at INTEGER NOT NULL);
CREATE TABLE learning_states(user_id TEXT PRIMARY KEY REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
CREATE TABLE provider_configs(user_id TEXT PRIMARY KEY REFERENCES users(id),format TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,ciphertext TEXT NOT NULL,iv TEXT NOT NULL);
CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
