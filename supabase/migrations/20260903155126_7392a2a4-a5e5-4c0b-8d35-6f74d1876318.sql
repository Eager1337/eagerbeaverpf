CREATE TABLE public.live_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  tagline text,
  description text,
  repo_url text,
  live_url text,
  custom_domain text,
  thumbnail_url text,
  tech text[] not null default '{}',
  stars integer,
  language text,
  featured boolean not null default false,
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT ON public.live_projects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_projects TO authenticated;
GRANT ALL ON public.live_projects TO service_role;

ALTER TABLE public.live_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published live projects"
ON public.live_projects FOR SELECT TO anon, authenticated
USING (published = true);

CREATE POLICY "Admins can view all live projects"
ON public.live_projects FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert live projects"
ON public.live_projects FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update live projects"
ON public.live_projects FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete live projects"
ON public.live_projects FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_live_projects_updated_at
BEFORE UPDATE ON public.live_projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();