import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Github, Globe, Maximize2, Star } from "lucide-react";
import { listPublishedLiveProjects } from "../../lib/live-projects.functions";

type Row = Record<string, any>;

/** Live, interactive previews of deployed projects, managed from the admin dashboard. */
export function LiveProjectShowcase() {
  const load = useServerFn(listPublishedLiveProjects);
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await load({});
        if (alive) setRows(res.projects as Row[]);
      } catch {
        // showcase is optional content
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  if (!rows.length) return null;

  return (
    <section id="live-projects" className="px-5 sm:px-8 py-20 border-t border-white/5">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs uppercase tracking-[0.3em] text-[#E63946]">Live builds</p>
        <h2 className="mt-3 font-[Anton,sans-serif] uppercase text-4xl sm:text-6xl leading-none">
          Deployed and running.
        </h2>
        <p className="mt-4 max-w-2xl text-sm text-[#A8A8A8]">
          Real applications, previewed straight from their live deployments. Click a preview to
          expand it, or open the site and the source on GitHub.
        </p>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {rows.map((p) => {
            const url = String(p.custom_domain || p.live_url || "");
            const id = String(p.id);
            const open = expanded === id;
            return (
              <article
                key={id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#151515] to-[#0C0C0C]"
              >
                <div className="relative bg-white">
                  {url ? (
                    <iframe
                      title={`${String(p.title)} live preview`}
                      src={url}
                      loading="lazy"
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                      className={`w-full transition-[height] duration-300 ${open ? "h-[640px]" : "h-72"}`}
                    />
                  ) : p.thumbnail_url ? (
                    <img
                      src={String(p.thumbnail_url)}
                      alt={`${String(p.title)} preview`}
                      loading="lazy"
                      className="h-72 w-full object-cover"
                    />
                  ) : (
                    <div className="h-72 w-full bg-[#111]" />
                  )}
                  {url ? (
                    <button
                      onClick={() => setExpanded(open ? null : id)}
                      className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white backdrop-blur hover:bg-black"
                    >
                      <Maximize2 className="h-3 w-3" /> {open ? "Shrink" : "Expand"}
                    </button>
                  ) : null}
                </div>

                <div className="p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-[Anton,sans-serif] uppercase text-2xl tracking-wide">
                      {String(p.title)}
                    </h3>
                    {p.featured ? (
                      <span className="rounded-full border border-[#E63946]/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[#E63946]">
                        Featured
                      </span>
                    ) : null}
                    {p.stars ? (
                      <span className="inline-flex items-center gap-1 text-xs text-[#A8A8A8]">
                        <Star className="h-3 w-3" /> {Number(p.stars)}
                      </span>
                    ) : null}
                  </div>
                  {p.tagline ? (
                    <p className="mt-2 text-sm text-[#A8A8A8]">{String(p.tagline)}</p>
                  ) : null}
                  {p.description && p.description !== p.tagline ? (
                    <p className="mt-3 text-sm text-[#8F8F8F] leading-relaxed">
                      {String(p.description)}
                    </p>
                  ) : null}

                  {Array.isArray(p.tech) && p.tech.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {p.tech.map((t: string) => (
                        <span
                          key={t}
                          className="rounded-full border border-white/15 px-3 py-1 text-xs text-[#F1FAEE]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-2">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0C0C0C] hover:bg-[#E63946] hover:text-white transition-colors"
                      >
                        <Globe className="h-4 w-4" /> Visit site{" "}
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    ) : null}
                    {p.repo_url ? (
                      <a
                        href={String(p.repo_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm hover:border-white/40"
                      >
                        <Github className="h-4 w-4" /> Source
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
