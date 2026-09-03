import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

function publicClient() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || `project-${Date.now()}`;

/** Public: published live project previews for the About / portfolio page. */
export const listPublishedLiveProjects = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .from("live_projects")
    .select("*")
    .eq("published", true)
    .order("featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { projects: data ?? [] };
});

/** Admin: every live project, published or not. */
export const listLiveProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("live_projects")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { projects: data ?? [] };
  });

/**
 * Admin: read public metadata for a GitHub repo so a connected repo can
 * auto-fill the title, description, language, stars and deployed URL.
 */
export const fetchGithubRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ repoUrl: z.string().min(4).max(300) }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const m = /github\.com\/([^/\s]+)\/([^/\s?#]+)/i.exec(data.repoUrl.trim());
    const pair = m
      ? `${m[1]}/${m[2].replace(/\.git$/, "")}`
      : data.repoUrl.trim().replace(/^\/+|\/+$/g, "");
    if (!/^[^/]+\/[^/]+$/.test(pair)) throw new Error("Enter a GitHub repo URL or owner/repo.");

    const res = await fetch(`https://api.github.com/repos/${pair}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "eager-beaver-portfolio" },
    });
    if (res.status === 404) throw new Error("Repository not found or private.");
    if (!res.ok) throw new Error(`GitHub responded with ${res.status}`);
    const repo = (await res.json()) as Record<string, any>;

    let topics: string[] = Array.isArray(repo.topics) ? repo.topics.slice(0, 8) : [];
    if (repo.language && !topics.includes(repo.language)) topics = [repo.language, ...topics];

    return {
      repo: {
        title: String(repo.name ?? "").replace(/[-_]+/g, " "),
        slug: slugify(String(repo.name ?? "")),
        tagline: repo.description ? String(repo.description).slice(0, 160) : "",
        description: repo.description ? String(repo.description) : "",
        repo_url: String(repo.html_url ?? `https://github.com/${pair}`),
        live_url: repo.homepage ? String(repo.homepage) : "",
        language: repo.language ? String(repo.language) : "",
        stars: Number(repo.stargazers_count ?? 0),
        tech: topics,
        thumbnail_url: `https://opengraph.githubassets.com/1/${pair}`,
      },
    };
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(120),
  slug: z.string().max(60).optional(),
  tagline: z.string().max(240).optional(),
  description: z.string().max(4000).optional(),
  repo_url: z.string().max(300).optional(),
  live_url: z.string().max(300).optional(),
  custom_domain: z.string().max(200).optional(),
  thumbnail_url: z.string().max(600).optional(),
  tech: z.array(z.string().max(40)).max(16).optional(),
  stars: z.number().int().nonnegative().optional(),
  language: z.string().max(60).optional(),
  featured: z.boolean().optional(),
  published: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

/** Admin: create or update a live project preview. */
export const saveLiveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(upsertSchema)
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { id, ...rest } = data;
    const row = {
      ...rest,
      slug: (rest.slug && rest.slug.length ? rest.slug : slugify(rest.title)) as string,
    };

    if (id) {
      const { data: updated, error } = await context.supabase
        .from("live_projects")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { project: updated };
    }

    const { data: created, error } = await context.supabase
      .from("live_projects")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { project: created };
  });

/** Admin: delete a live project preview. */
export const deleteLiveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("live_projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
