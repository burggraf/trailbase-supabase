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

-- Ordinary scalar FK/trigger characterization, not relationship-query support.
CREATE TABLE todo_links (
  id BLOB PRIMARY KEY NOT NULL CHECK(is_uuid_v4(id)),
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  restricted_todo_id BLOB REFERENCES todos(id) ON DELETE RESTRICT,
  cascaded_todo_id BLOB REFERENCES todos(id) ON DELETE CASCADE,
  note TEXT NOT NULL
) STRICT;
CREATE INDEX todo_links_owner ON todo_links(user_id);
CREATE TABLE todo_audit (
  audit_key INTEGER PRIMARY KEY NOT NULL,
  todo_id BLOB NOT NULL CHECK(is_uuid_v4(todo_id)),
  user_id BLOB NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE'))
) STRICT;
CREATE INDEX todo_audit_owner ON todo_audit(user_id);
CREATE TRIGGER todos_audit_insert BEFORE INSERT ON todos BEGIN
  INSERT INTO todo_audit(todo_id,user_id,operation) VALUES(NEW.id,NEW.user_id,'INSERT');
  SELECT RAISE(ABORT,'phase_a_trigger_rejection') WHERE NEW.note = 'phase-a-trigger-reject';
END;
CREATE TRIGGER todos_audit_update BEFORE UPDATE ON todos BEGIN
  INSERT INTO todo_audit(todo_id,user_id,operation) VALUES(NEW.id,NEW.user_id,'UPDATE');
  SELECT RAISE(ABORT,'phase_a_trigger_rejection') WHERE NEW.note = 'phase-a-trigger-reject';
END;
CREATE TRIGGER todos_audit_delete BEFORE DELETE ON todos BEGIN
  INSERT INTO todo_audit(todo_id,user_id,operation) VALUES(OLD.id,OLD.user_id,'DELETE');
  SELECT RAISE(ABORT,'phase_a_trigger_rejection') WHERE OLD.note = 'phase-a-delete-reject';
END;
