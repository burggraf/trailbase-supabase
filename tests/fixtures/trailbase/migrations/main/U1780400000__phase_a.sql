CREATE TABLE todos (
  id BLOB PRIMARY KEY NOT NULL CHECK(is_uuid_v4(id)),
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  title TEXT NOT NULL UNIQUE,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 0 CHECK(priority >= 0),
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX todos_owner ON todos(user_id);
CREATE VIEW todos_read AS SELECT * FROM todos;
CREATE TABLE integer_todos (
  todo_key INTEGER PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  title TEXT NOT NULL
) STRICT;
