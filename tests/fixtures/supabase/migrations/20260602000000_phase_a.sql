CREATE TABLE public.todos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL UNIQUE,
  completed boolean NOT NULL DEFAULT false,
  priority bigint NOT NULL DEFAULT 0 CHECK(priority >= 0),
  note text,
  created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM now()))
);
CREATE INDEX todos_owner ON public.todos(user_id);
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.todos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.todos TO authenticated;
CREATE POLICY owner_read ON public.todos FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_create ON public.todos FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_update ON public.todos FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_delete ON public.todos FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE VIEW public.todos_read WITH (security_invoker = true) AS SELECT * FROM public.todos;
REVOKE ALL ON public.todos_read FROM anon, authenticated;
GRANT SELECT ON public.todos_read TO authenticated;

CREATE TABLE public.integer_todos (
  todo_key bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL
);
ALTER TABLE public.integer_todos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integer_todos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integer_todos TO authenticated;
CREATE POLICY owner_read ON public.integer_todos FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_create ON public.integer_todos FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_update ON public.integer_todos FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_delete ON public.integer_todos FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
-- Ordinary scalar FK/trigger characterization, not relationship-query support.
CREATE TABLE public.todo_links (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restricted_todo_id uuid REFERENCES public.todos(id) ON DELETE RESTRICT,
  cascaded_todo_id uuid REFERENCES public.todos(id) ON DELETE CASCADE,
  note text NOT NULL
);
CREATE INDEX todo_links_owner ON public.todo_links(user_id);
ALTER TABLE public.todo_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.todo_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.todo_links TO authenticated;
CREATE POLICY owner_read ON public.todo_links FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_create ON public.todo_links FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_update ON public.todo_links FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY owner_delete ON public.todo_links FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE TABLE public.todo_audit (
  audit_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  todo_id uuid NOT NULL,
  user_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE'))
);
CREATE INDEX todo_audit_owner ON public.todo_audit(user_id);
ALTER TABLE public.todo_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.todo_audit FROM anon, authenticated;
GRANT SELECT ON public.todo_audit TO authenticated;
CREATE POLICY owner_read ON public.todo_audit FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
-- Fixed SQL only; callers cannot write audit rows or execute this as an RPC.
CREATE FUNCTION public.audit_todo_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE subject public.todos;
BEGIN
  IF TG_OP = 'DELETE' THEN subject := OLD; ELSE subject := NEW; END IF;
  INSERT INTO public.todo_audit(todo_id,user_id,operation) VALUES(subject.id,subject.user_id,TG_OP);
  IF (TG_OP IN ('INSERT','UPDATE') AND subject.note = 'phase-a-trigger-reject')
    OR (TG_OP = 'DELETE' AND subject.note = 'phase-a-delete-reject') THEN
    RAISE EXCEPTION 'phase_a_trigger_rejection' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_todo_changes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER todos_audit BEFORE INSERT OR UPDATE OR DELETE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.audit_todo_changes();
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
-- DEFAULT replica identity: DELETE claims will be limited to keys until G6 is approved.
