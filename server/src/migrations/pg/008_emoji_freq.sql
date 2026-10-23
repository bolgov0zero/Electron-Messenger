-- Часто используемые смайлы человека: общий список на всех его устройствах (routes/users.js)
CREATE TABLE IF NOT EXISTS user_emoji_freq (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji   TEXT   NOT NULL,
  cnt     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, emoji)
);
