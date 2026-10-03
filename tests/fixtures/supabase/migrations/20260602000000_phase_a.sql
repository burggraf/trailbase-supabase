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
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
-- DEFAULT replica identity: DELETE claims will be limited to keys until G6 is approved.
