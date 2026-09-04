import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowUpRight, Github, Maximize2, Star } from "lucide-react";
import {
  listPublishedLiveProjects,
  trackLiveProjectEvent,
} from "../../lib/live-projects.functions";

type Row = Record<string, any>;
type Frame = "loading" | "ok" | "blocked";

const SESSION_KEY = "eb:live-preview-session";

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY) ?? "";
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/** Live, interactive previews of deployed projects, managed from the admin dashboard. */
export function LiveProjectShowcase() {
  const load = useServerFn(listPublishedLiveProjects);
  const track = useServerFn(trackLiveProjectEvent);
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const send = useCallback(
    (project: Row, kind: "preview" | "visit" | "source" | "blocked") => {
      void track({
        data: {
          projectId: String(project.id),
          slug: String(project.slug ?? ""),
          kind,
          sessionId: sessionId(),
          referrer: typeof document === "undefined" ? "" : document.referrer || "",
        },
      }).catch(() => {
        /* analytics must never break the page */
      });
    },
    [track],
  );

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
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, [load]);

  const watchFrame = (project: Row) => {
    const id = String(project.id);
    if (frames[id]) return;
    setFrames((f) => ({ ...f, [id]: "loading" }));
    timers.current[id] = setTimeout(() => {
      setFrames((f) => (f[id] === "ok" ? f : { ...f, [id]: "blocked" }));
      send(project, "blocked");
    }, 8000);
  };

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
            const state = frames[id];
            const blocked = state === "blocked";
            return (
              <article
                key={id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#151515] to-[#0C0C0C]"
              >
                <div className="relative bg-white">
                  {url && !blocked ? (
                    <iframe
                      title={`${String(p.title)} live preview`}
                      src={url}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
                      onLoad={() => {
                        const t = timers.current[id];
                        if (t) clearTimeout(t);
                        setFrames((f) => ({ ...f, [id]: "ok" }));
                      }}
                      ref={(el) => {
                        if (el) watchFrame(p);
                      }}
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

                  {blocked ? (
                    <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-black/80 px-4 py-3 text-[11px] text-white backdrop-blur">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                      <span className="text-[#D8D8D8]">
                        This site does not allow being shown inside another page.
                      </span>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => send(p, "visit")}
                          className="underline decoration-[#E63946] underline-offset-2"
                        >
                          Open it in a new tab
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {url && !blocked ? (
                    <button
                      onClick={() => {
                        setExpanded(open ? null : id);
                        if (!open) send(p, "preview");
                      }}
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
                    <p className="mt-2 text-sm text-[#D8D8D8]">{String(p.tagline)}</p>
                  ) : null}
                  {p.description ? (
                    <p className="mt-2 text-sm text-[#A8A8A8]">{String(p.description)}</p>
                  ) : null}
                  {p.readme ? (
                    <p className="mt-3 line-clamp-4 text-xs leading-relaxed text-[#8E8E8E]">
                      {String(p.readme)}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {p.framework ? (
                      <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-[#D8D8D8]">
                        {String(p.framework)}
                      </span>
                    ) : null}
                    {(Array.isArray(p.tech) ? (p.tech as string[]) : []).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-[#A8A8A8]"
                      >
                        {t}
                      </span>
                    ))}
                    {p.license ? (
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-[#A8A8A8]">
                        {String(p.license)} licence
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => send(p, "visit")}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90"
                      >
                        Visit site <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {p.repo_url ? (
                      <a
                        href={String(p.repo_url)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => send(p, "source")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs text-white hover:bg-white/5"
                      >
                        <Github className="h-3.5 w-3.5" /> Source
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
