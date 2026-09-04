ALTER TABLE public.live_projects
  ADD COLUMN IF NOT EXISTS readme text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS framework text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS license text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.live_project_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.live_projects(id) ON DELETE CASCADE,
  slug text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('preview', 'visit', 'source', 'blocked')),
  session_id text NOT NULL DEFAULT '',
  referrer text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT INSERT ON public.live_project_events TO anon;
GRANT SELECT, INSERT ON public.live_project_events TO authenticated;
GRANT ALL ON public.live_project_events TO service_role;

ALTER TABLE public.live_project_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record a preview interaction"
  ON public.live_project_events FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Admins can read preview interactions"
  ON public.live_project_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS live_project_events_project_idx
  ON public.live_project_events (project_id, kind);