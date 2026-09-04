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


function publicDb() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: any, init: any) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    }),
  );
}

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || `project-${Date.now()}`;

/** Public: published live project previews for the About / portfolio page. */
export const listPublishedLiveProjects = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await publicDb();
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

/** Public: record that a visitor opened a preview, or clicked Visit site / Source. */
export const trackLiveProjectEvent = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      slug: z.string().max(80).default(""),
      kind: z.enum(["preview", "visit", "source", "blocked"]),
      sessionId: z.string().max(80).default(""),
      referrer: z.string().max(300).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = await publicDb();
    await supabase.from("live_project_events").insert({
      project_id: data.projectId,
      slug: data.slug,
      kind: data.kind,
      session_id: data.sessionId,
      referrer: data.referrer,
    });
    return { ok: true };
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

    // README preview (first ~1200 characters of plain text) plus framework detection.
    let readme = "";
    let framework = "";
    try {
      const rd = await fetch(`https://api.github.com/repos/${pair}/readme`, {
        headers: {
          Accept: "application/vnd.github.raw",
          "User-Agent": "eager-beaver-portfolio",
        },
      });
      if (rd.ok) {
        const raw = await rd.text();
        readme = raw
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[#>*_`|-]{1,}/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1200);
      }
    } catch {
      /* README is optional */
    }

    try {
      const pkgRes = await fetch(
        `https://raw.githubusercontent.com/${pair}/HEAD/package.json`,
        { headers: { "User-Agent": "eager-beaver-portfolio" } },
      );
      if (pkgRes.ok) {
        const pkg = (await pkgRes.json()) as Record<string, any>;
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
        const map: [string, string][] = [
          ["next", "Next.js"],
          ["@tanstack/react-start", "TanStack Start"],
          ["nuxt", "Nuxt"],
          ["@remix-run/react", "Remix"],
          ["@angular/core", "Angular"],
          ["svelte", "Svelte"],
          ["vue", "Vue"],
          ["react-native", "React Native"],
          ["astro", "Astro"],
          ["react", "React"],
          ["express", "Express"],
        ];
        framework = map.find(([dep]) => deps[dep])?.[1] ?? "";
      }
    } catch {
      /* framework detection is best effort */
    }
    if (!framework && repo.language) framework = String(repo.language);

    const license = repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION"
      ? String(repo.license.spdx_id)
      : repo.license?.name
        ? String(repo.license.name)
        : "";

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
        readme,
        framework,
        license,
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
  readme: z.string().max(4000).optional(),
  framework: z.string().max(80).optional(),
  license: z.string().max(80).optional(),
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

/** Admin: per-project counts of preview opens, Visit site clicks and Source clicks. */
export const getLiveProjectStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("live_project_events")
      .select("project_id, kind, session_id, created_at")
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) throw new Error(error.message);

    const stats: Record<
      string,
      { preview: number; visit: number; source: number; blocked: number; visitors: number }
    > = {};
    const seen: Record<string, Set<string>> = {};
    for (const row of (data ?? []) as any[]) {
      const id = String(row.project_id ?? "");
      if (!id) continue;
      stats[id] ??= { preview: 0, visit: 0, source: 0, blocked: 0, visitors: 0 };
      const kind = String(row.kind) as "preview" | "visit" | "source" | "blocked";
      if (kind in stats[id]) stats[id][kind] += 1;
      seen[id] ??= new Set();
      if (row.session_id) seen[id].add(String(row.session_id));
    }
    for (const id of Object.keys(stats)) stats[id].visitors = seen[id]?.size ?? 0;
    return { stats };
  });

/** Admin: rewrite the display order of every project in one go. */
export const reorderLiveProjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ ids: z.array(z.string().uuid()).max(200) }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    let i = 0;
    for (const id of data.ids) {
      const { error } = await context.supabase
        .from("live_projects")
        .update({ sort_order: i })
        .eq("id", id);
      if (error) throw new Error(error.message);
      i += 1;
    }
    return { ok: true };
  });
