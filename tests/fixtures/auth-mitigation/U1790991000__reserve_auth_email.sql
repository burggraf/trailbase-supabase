-- INVESTIGATIONAL deployment requirement, NOT a stock TrailBase guarantee.
-- Refuse ambiguous existing identities; never merge/delete/reassign auth rows.
CREATE TEMP TABLE trailbase_supabase_auth_preflight (valid INTEGER CHECK(valid = 1));
INSERT INTO trailbase_supabase_auth_preflight
SELECT 0 FROM (
  SELECT id, email AS address FROM _user WHERE email IS NOT NULL
  UNION ALL
  SELECT id, unverified_email AS address FROM _user WHERE unverified_email IS NOT NULL
)
GROUP BY address COLLATE NOCASE HAVING COUNT(DISTINCT id) > 1 LIMIT 1;
DROP TABLE trailbase_supabase_auth_preflight;

CREATE UNIQUE INDEX trailbase_supabase_pending_email ON _user(unverified_email COLLATE NOCASE);
CREATE TRIGGER trailbase_supabase_email_insert BEFORE INSERT ON _user
WHEN EXISTS (
  SELECT 1 FROM _user AS existing WHERE
    (NEW.email IS NOT NULL AND (existing.email = NEW.email OR existing.unverified_email = NEW.email)) OR
    (NEW.unverified_email IS NOT NULL AND (existing.email = NEW.unverified_email OR existing.unverified_email = NEW.unverified_email))
)
BEGIN
  SELECT RAISE(ABORT, 'auth email reservation conflict');
END;
CREATE TRIGGER trailbase_supabase_email_update BEFORE UPDATE OF email, unverified_email ON _user
WHEN EXISTS (
  SELECT 1 FROM _user AS existing WHERE existing.id <> OLD.id AND (
    (NEW.email IS NOT NULL AND (existing.email = NEW.email OR existing.unverified_email = NEW.email)) OR
    (NEW.unverified_email IS NOT NULL AND (existing.email = NEW.unverified_email OR existing.unverified_email = NEW.unverified_email))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'auth email reservation conflict');
END;
