import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  Github,
  Globe,
  Loader2,
  MousePointerClick,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import {
  deleteLiveProject,
  fetchGithubRepo,
  getLiveProjectStats,
  listLiveProjects,
  reorderLiveProjects,
  saveLiveProject,
} from "../../lib/live-projects.functions";

type Row = Record<string, any>;

const EMPTY = {
  id: "",
  title: "",
  slug: "",
  tagline: "",
  description: "",
  repo_url: "",
  live_url: "",
  custom_domain: "",
  thumbnail_url: "",
  tech: "",
  language: "",
  stars: 0,
  featured: false,
  published: true,
  sort_order: 0,
  readme: "",
  framework: "",
  license: "",
};

type Draft = typeof EMPTY;

const input =
  "min-h-[40px] w-full rounded-lg border border-white/15 bg-black/50 px-3 text-sm outline-none focus:border-fuchsia-400";
const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const labelText = "mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-white/45";

/** Connect GitHub repos or deployed links and preview them live on the About page. */
export function LiveProjectsPanel() {
  const load = useServerFn(listLiveProjects);
  const save = useServerFn(saveLiveProject);
  const remove = useServerFn(deleteLiveProject);
  const github = useServerFn(fetchGithubRepo);
  const loadStats = useServerFn(getLiveProjectStats);
  const reorder = useServerFn(reorderLiveProjects);

  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState<
    Record<string, { preview: number; visit: number; source: number; blocked: number; visitors: number }>
  >({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await load({});
      setRows(res.projects as Row[]);
      try {
        const st = await loadStats({});
        setStats(st.stats as typeof stats);
      } catch {
        /* analytics are optional */
      }
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load projects.");
    } finally {
      setLoading(false);
    }
  }, [load, loadStats]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const connect = async () => {
    setConnecting(true);
    setErr("");
    setMsg("");
    try {
      const res = await github({ data: { repoUrl: draft.repo_url } });
      const r = res.repo;
      setDraft((d) => ({
        ...d,
        title: d.title || r.title,
        slug: d.slug || r.slug,
        tagline: d.tagline || r.tagline,
        description: d.description || r.description,
        repo_url: r.repo_url,
        live_url: d.live_url || r.live_url,
        thumbnail_url: d.thumbnail_url || r.thumbnail_url,
        language: r.language,
        stars: r.stars,
        tech: d.tech || r.tech.join(", "),
        readme: r.readme ?? "",
        framework: r.framework ?? "",
        license: r.license ?? "",
      }));
      setMsg("Repository connected. Details filled in from GitHub.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reach GitHub.");
    } finally {
      setConnecting(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await save({
        data: {
          ...(draft.id ? { id: draft.id } : {}),
          title: draft.title,
          slug: draft.slug || undefined,
          tagline: draft.tagline,
          description: draft.description,
          repo_url: draft.repo_url,
          live_url: draft.live_url,
          custom_domain: draft.custom_domain,
          thumbnail_url: draft.thumbnail_url,
          language: draft.language,
          stars: Number(draft.stars) || 0,
          tech: draft.tech
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          featured: draft.featured,
          published: draft.published,
          sort_order: Number(draft.sort_order) || 0,
          readme: draft.readme,
          framework: draft.framework,
          license: draft.license,
        },
      });
      setDraft({ ...EMPTY });
      setMsg("Saved. It now shows on your About page.");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const edit = (row: Row) =>
    setDraft({
      id: String(row.id),
      title: String(row.title ?? ""),
      slug: String(row.slug ?? ""),
      tagline: String(row.tagline ?? ""),
      description: String(row.description ?? ""),
      repo_url: String(row.repo_url ?? ""),
      live_url: String(row.live_url ?? ""),
      custom_domain: String(row.custom_domain ?? ""),
      thumbnail_url: String(row.thumbnail_url ?? ""),
      tech: Array.isArray(row.tech) ? row.tech.join(", ") : "",
      language: String(row.language ?? ""),
      stars: Number(row.stars ?? 0),
      featured: Boolean(row.featured),
      published: Boolean(row.published),
      sort_order: Number(row.sort_order ?? 0),
      readme: String(row.readme ?? ""),
      framework: String(row.framework ?? ""),
      license: String(row.license ?? ""),
    });

  const move = async (index: number, delta: number) => {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    next[index] = next[target];
    next[target] = a;
    setRows(next);
    try {
      await reorder({ data: { ids: next.map((r) => String(r.id)) } });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reorder.");
    }
  };

  const previewUrl = draft.custom_domain || draft.live_url;

  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Globe className="h-4 w-4 text-fuchsia-300" /> Live project previews
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-white/55">
          Connect a GitHub repository or paste a deployed link (Vercel, Netlify or your own custom
          domain). Published projects appear as live, interactive previews in the About page.
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className={labelText}>GitHub repository</span>
            <div className="flex gap-2">
              <input
                value={draft.repo_url}
                onChange={(e) => set("repo_url", e.target.value)}
                placeholder="https://github.com/Eager1337/my-app"
                className={input}
              />
              <button
                onClick={() => void connect()}
                disabled={connecting || draft.repo_url.trim().length < 4}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs hover:bg-white/10 disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Github className="h-3.5 w-3.5" />
                )}
                Connect
              </button>
            </div>
          </label>
          <label className="block">
            <span className={labelText}>Deployed link (Vercel etc.)</span>
            <input
              value={draft.live_url}
              onChange={(e) => set("live_url", e.target.value)}
              placeholder="https://my-app.vercel.app"
              className={input}
            />
          </label>
          <label className="block">
            <span className={labelText}>Custom domain (optional)</span>
            <input
              value={draft.custom_domain}
              onChange={(e) => set("custom_domain", e.target.value)}
              placeholder="https://myapp.com"
              className={input}
            />
          </label>
          <label className="block">
            <span className={labelText}>Project title</span>
            <input
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  title: e.target.value,
                  slug: d.id ? d.slug : slugify(e.target.value),
                }))
              }
              className={input}
            />
          </label>
          <label className="block">
            <span className={labelText}>Web address slug (auto)</span>
            <input
              value={draft.slug}
              onChange={(e) => set("slug", slugify(e.target.value))}
              placeholder="my-app"
              className={input}
            />
          </label>
          <label className="block">
            <span className={labelText}>Main framework</span>
            <input
              value={draft.framework}
              onChange={(e) => set("framework", e.target.value)}
              placeholder="Next.js"
              className={input}
            />
          </label>
          <label className="block">
            <span className={labelText}>Licence</span>
            <input
              value={draft.license}
              onChange={(e) => set("license", e.target.value)}
              placeholder="MIT"
              className={input}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelText}>README preview (imported from GitHub)</span>
            <textarea
              value={draft.readme}
              onChange={(e) => set("readme", e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
            />
          </label>
          <label className="block">
            <span className={labelText}>Tech tags (comma separated)</span>
            <input
              value={draft.tech}
              onChange={(e) => set("tech", e.target.value)}
              placeholder="React, TypeScript, Supabase"
              className={input}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelText}>Tagline</span>
            <input
              value={draft.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              className={input}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelText}>Description</span>
            <textarea
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
            />
          </label>
          <label className="block">
            <span className={labelText}>Thumbnail image URL</span>
            <input
              value={draft.thumbnail_url}
              onChange={(e) => set("thumbnail_url", e.target.value)}
              className={input}
            />
          </label>
          <label className="block">
            <span className={labelText}>Display order</span>
            <input
              type="number"
              value={draft.sort_order}
              onChange={(e) => set("sort_order", Number(e.target.value))}
              className={input}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-white/70">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.featured}
              onChange={(e) => set("featured", e.target.checked)}
            />
            Featured
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => set("published", e.target.checked)}
            />
            Published on About page
          </label>
          {draft.language ? <span>Language: {draft.language}</span> : null}
          {draft.stars ? (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3" /> {draft.stars}
            </span>
          ) : null}
        </div>

        {err ? (
          <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-200">
            {err}
          </p>
        ) : null}
        {msg ? (
          <p className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-xs text-emerald-200">
            {msg}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => void submit()}
            disabled={busy || draft.title.trim().length < 2}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-sky-500 px-5 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {draft.id ? "Update project" : "Add project"}
          </button>
          {draft.id ? (
            <button
              onClick={() => setDraft({ ...EMPTY })}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm hover:bg-white/10"
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        {previewUrl ? (
          <div className="mt-4">
            <div className="mb-2 text-[11px] text-white/45">Live preview: {previewUrl}</div>
            <iframe
              title="Deployed project preview"
              src={previewUrl}
              className="h-[420px] w-full rounded-xl border border-white/10 bg-white"
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Your projects</h3>
          <button
            onClick={() => void refresh()}
            aria-label="Refresh projects"
            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-white/15 bg-white/5 hover:bg-white/10"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li
              key={String(r.id)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-3"
            >
              <button onClick={() => edit(r)} className="min-w-0 text-left">
                <div className="truncate text-sm">
                  {String(r.title)} {r.featured ? "★" : ""}
                </div>
                <div className="truncate text-[11px] text-white/45">
                  {String(r.custom_domain || r.live_url || r.repo_url || "no link")} ·{" "}
                  {r.published ? "published" : "hidden"} · order {Number(r.sort_order ?? 0)}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-white/60">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" /> {stats[String(r.id)]?.preview ?? 0} previews opened
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MousePointerClick className="h-3 w-3" /> {stats[String(r.id)]?.visit ?? 0} visit
                    site
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Github className="h-3 w-3" /> {stats[String(r.id)]?.source ?? 0} source
                  </span>
                  <span>{stats[String(r.id)]?.visitors ?? 0} people</span>
                  {stats[String(r.id)]?.blocked ? (
                    <span className="text-amber-300">
                      {stats[String(r.id)]?.blocked} blocked embeds
                    </span>
                  ) : null}
                </div>
              </button>
              <div className="flex gap-1.5">
                <button
                  onClick={() => void move(i, -1)}
                  aria-label="Move project up"
                  disabled={i === 0}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void move(i, 1)}
                  aria-label="Move project down"
                  disabled={i === rows.length - 1}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                {r.custom_domain || r.live_url ? (
                  <a
                    href={String(r.custom_domain || r.live_url)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open live site"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                <button
                  onClick={() =>
                    void (async () => {
                      if (!window.confirm("Delete this project?")) return;
                      await remove({ data: { id: String(r.id) } });
                      if (draft.id === String(r.id)) setDraft({ ...EMPTY });
                      await refresh();
                    })()
                  }
                  aria-label="Delete project"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-red-400/25 bg-red-400/10 text-red-200 hover:bg-red-400/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
          {!loading && !rows.length ? (
            <li className="rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-center text-xs text-white/45">
              No projects yet. Connect a GitHub repo or paste a deployed link above.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
