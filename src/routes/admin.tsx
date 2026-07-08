import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import JSZip from "jszip";
import {
  LayoutDashboard,
  Image as ImageIcon,
  Sparkles,
  DollarSign,
  Compass,
  Rocket,
  User,
  Plus,
  Trash2,
  Save,
  LogOut,
  Lock,
  ShieldCheck,
  ShieldAlert,
  Camera,
  CameraOff,
  AlertTriangle,
  Download,
  Upload,
  RotateCcw,
  ExternalLink,
  Mail,
  Clock,
  Timer,
  Loader2,
} from "lucide-react";
import {
  useContent,
  type ToonSlide,
  type PricingTier,
  type CustomLanding,
} from "../lib/content-store";
import {
  SECURITY_QUESTIONS,
  checkSecurityAnswers,
  requestCamera,
  stopCamera,
  capturePhoto,
  getDeviceId,
  gatherClientMeta,
} from "../lib/security-gate";
import { supabase } from "../integrations/supabase/client";
import {
  logIntruder,
  checkAdminLockout,
  recordAdminFailure,
  clearAdminFailures,
  claimAdminIfUnclaimed,
  getMyAdminStatus,
  listIntruders,
  deleteIntruderRecord,
  clearAllIntruders,
  getPrivacySettings,
  updatePrivacySettings,
  purgeExpiredNow,
} from "../lib/security.functions";
import type { Legend } from "../data/legends";
import type { Project, ProjectCategory } from "../data/projects";
import { CATEGORIES } from "../data/projects";

export type IntruderRow = {
  id: string;
  created_at: string;
  reason: string;
  username_tried: string;
  photo: string | null;
  ip: string | null;
  user_agent: string | null;
  language: string | null;
  platform: string | null;
  screen: string | null;
  timezone: string | null;
};



export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Portfolio content control" },
      {
        name: "description",
        content:
          "Sign-in gated admin dashboard to manage Legends, ToonHub, pricing, Explore projects, and custom landing pages.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminGate,
});

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050510] text-white">
      <Loader2 className="h-6 w-6 animate-spin text-fuchsia-400" />
    </div>
  );
}

function AdminGate() {
  const [status, setStatus] = useState<"loading" | "out" | "in">("loading");
  const getAdmin = useServerFn(getMyAdminStatus);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStatus("out");
      return;
    }
    try {
      const res = await getAdmin();
      if (res.isAdmin) {
        setStatus("in");
      } else {
        await supabase.auth.signOut();
        setStatus("out");
      }
    } catch {
      setStatus("out");
    }
  }, [getAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (status === "loading") return <FullScreenLoader />;
  if (status === "out") return <SignIn onAuthed={() => setStatus("in")} />;
  return (
    <AdminDashboard
      onSignOut={async () => {
        stopCamera();
        await supabase.auth.signOut();
        setStatus("out");
      }}
    />
  );
}

/* ---------------- Sign-in ---------------- */

function SignIn({ onAuthed }: { onAuthed: () => void }) {
  const [step, setStep] = useState<"questions" | "creds">("questions");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [warned, setWarned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<"idle" | "granted" | "denied">("idle");
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [lockSeconds, setLockSeconds] = useState(0);

  const doLog = useServerFn(logIntruder);
  const doCheckLock = useServerFn(checkAdminLockout);
  const doRecordFail = useServerFn(recordAdminFailure);
  const doClearFail = useServerFn(clearAdminFailures);
  const doClaim = useServerFn(claimAdminIfUnclaimed);

  const locked = lockSeconds > 0;

  // Camera + lockout status on mount.
  useEffect(() => {
    let cancelled = false;
    requestCamera().then((stream) => {
      if (!cancelled) setCamera(stream ? "granted" : "denied");
    });
    const deviceId = getDeviceId();
    doCheckLock({ data: { deviceId } })
      .then((res) => {
        if (cancelled) return;
        if (res.locked) setLockSeconds(res.secondsLeft);
        setAttemptsLeft(res.attemptsRemaining);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doCheckLock]);

  // Lockout countdown.
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const t = setInterval(() => setLockSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockSeconds]);

  const triggerIntruder = async (reason: string) => {
    setWarned(true);
    const deviceId = getDeviceId();
    // Record the failed attempt for lockout accounting.
    try {
      const res = await doRecordFail({ data: { deviceId } });
      setAttemptsLeft(res.attemptsRemaining);
      if (res.locked) setLockSeconds(res.secondsLeft);
    } catch {
      /* ignore */
    }
    // Capture + persist the intruder (photo may be null if camera blocked).
    try {
      const photo = await capturePhoto();
      const meta = gatherClientMeta();
      await doLog({
        data: {
          reason,
          usernameTried: email.trim() || "(none)",
          photo,
          deviceId,
          ...meta,
        },
      });
    } catch {
      /* ignore */
    }
  };

  const submitQuestions = (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;
    setBusy(true);
    setErr(null);
    setTimeout(async () => {
      if (checkSecurityAnswers(answers)) {
        setStep("creds");
        setWarned(false);
      } else {
        setErr("One or more security answers are incorrect.");
        await triggerIntruder("Failed security questions");
      }
      setBusy(false);
    }, 250);
  };

  const submitCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pass,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) {
          setErr(error.message);
          setBusy(false);
          return;
        }
        if (!data.session) {
          setErr("Account created. Please confirm your email, then sign in.");
          setMode("signin");
          setBusy(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: pass,
        });
        if (error) {
          setErr("Wrong email or password.");
          await triggerIntruder("Wrong email or password");
          setBusy(false);
          return;
        }
      }

      // Session established — verify (or claim) owner privileges.
      const claim = await doClaim();
      if (claim.isAdmin) {
        await doClearFail({ data: { deviceId: getDeviceId() } });
        onAuthed();
      } else {
        await supabase.auth.signOut();
        setErr("This account is not authorized to access the admin panel.");
        await triggerIntruder("Unauthorized account access");
      }
    } catch {
      setErr("Something went wrong. Please try again.");
    }
    setBusy(false);
  };

  const mmss = `${String(Math.floor(lockSeconds / 60)).padStart(2, "0")}:${String(
    lockSeconds % 60,
  ).padStart(2, "0")}`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050510] text-white">
      {/* animated gradient background */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 45% at 15% 20%, rgba(168,85,247,0.35), transparent 60%), radial-gradient(50% 40% at 85% 30%, rgba(56,189,248,0.35), transparent 60%), radial-gradient(45% 45% at 50% 90%, rgba(236,72,153,0.28), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />

      {/* floating orbs */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full blur-3xl opacity-60"
          style={{
            width: 240 + i * 80,
            height: 240 + i * 80,
            background: ["#a855f7", "#38bdf8", "#ec4899"][i],
            left: `${20 + i * 25}%`,
            top: `${10 + i * 20}%`,
          }}
          animate={{ x: [0, 30, -20, 0], y: [0, -40, 20, 0] }}
          transition={{ duration: 12 + i * 3, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="rounded-3xl border border-white/15 bg-white/[0.03] p-8 backdrop-blur-2xl shadow-[0_30px_90px_-20px_rgba(168,85,247,0.4)]">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-sky-500 shadow-lg shadow-fuchsia-500/30">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  Portfolio OS
                </div>
                <h1
                  className="text-2xl font-black tracking-tight"
                  style={{ fontFamily: "'Kanit', sans-serif" }}
                >
                  Command Center
                </h1>
              </div>
            </div>

            {/* camera / security status */}
            <div
              className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] ${
                camera === "granted"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                  : camera === "denied"
                    ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                    : "border-white/15 bg-white/5 text-white/60"
              }`}
            >
              {camera === "granted" ? (
                <Camera className="h-3.5 w-3.5" />
              ) : (
                <CameraOff className="h-3.5 w-3.5" />
              )}
              {camera === "granted"
                ? "Security camera active — this area is monitored."
                : camera === "denied"
                  ? "Camera access is required to continue. Failed attempts are still logged."
                  : "Requesting camera access for security verification…"}
            </div>

            {/* lockout banner */}
            {locked && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-500/15 px-3 py-3 text-xs text-red-200">
                <Timer className="h-4 w-4 shrink-0 text-red-400" />
                <div>
                  <div className="font-bold uppercase tracking-wide">Temporarily locked</div>
                  <p className="mt-0.5 text-red-200/90">
                    Too many failed attempts. Try again in{" "}
                    <span className="font-mono font-bold">{mmss}</span>.
                  </p>
                </div>
              </div>
            )}

            {/* intruder warning */}
            <AnimatePresence>
              {warned && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 overflow-hidden"
                >
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/50 bg-red-500/15 px-3 py-3 text-xs text-red-200">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    <div>
                      <div className="font-bold uppercase tracking-wide">
                        ⚠️ Unauthorized access detected
                      </div>
                      <p className="mt-1 leading-relaxed text-red-200/90">
                        Your photo, device details, IP fingerprint and location data have been
                        captured and reported to the owner's security dashboard. Leave this page
                        immediately — continued tampering will be prosecuted.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {step === "questions" ? (
              <>
                <p className="mt-4 text-sm text-white/60">
                  Answer the security questions to prove you are the owner.
                </p>
                <form onSubmit={submitQuestions} className="mt-6 space-y-4">
                  {SECURITY_QUESTIONS.map((q, i) => (
                    <label key={q.id} className="block">
                      <span className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                        Question {i + 1}
                      </span>
                      <span className="mt-1 block text-sm text-white/80">{q.question}</span>
                      <input
                        value={answers[q.id] ?? ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        disabled={locked}
                        className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-400 disabled:opacity-50"
                        placeholder="Your answer"
                      />
                    </label>
                  ))}

                  {err && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      {err}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || locked}
                    className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-fuchsia-500 to-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition-transform hover:scale-[1.01] disabled:opacity-60"
                  >
                    <span className="relative z-10">{busy ? "Verifying…" : "Verify identity"}</span>
                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm text-white/60">
                  Identity confirmed.{" "}
                  {mode === "signin"
                    ? "Enter your owner credentials to continue."
                    : "Create the owner account (first account only)."}
                </p>
                <form onSubmit={submitCreds} className="mt-6 space-y-4">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                      Email
                    </span>
                    <div className="relative mt-1.5">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                      <input
                        autoFocus
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={locked}
                        className="w-full rounded-xl border border-white/15 bg-black/40 pl-10 pr-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-400 disabled:opacity-50"
                        placeholder="owner@email.com"
                        autoComplete="email"
                      />
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                      Password
                    </span>
                    <div className="relative mt-1.5">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                      <input
                        type="password"
                        value={pass}
                        onChange={(e) => setPass(e.target.value)}
                        disabled={locked}
                        className="w-full rounded-xl border border-white/15 bg-black/40 pl-10 pr-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-400 disabled:opacity-50"
                        placeholder="••••••••••"
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      />
                    </div>
                  </label>

                  {err && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      {err}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || locked}
                    className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-fuchsia-500 to-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition-transform hover:scale-[1.01] disabled:opacity-60"
                  >
                    <span className="relative z-10">
                      {busy
                        ? "Verifying…"
                        : mode === "signup"
                          ? "Create owner account"
                          : "Enter dashboard"}
                    </span>
                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode((m) => (m === "signin" ? "signup" : "signin"));
                      setErr(null);
                    }}
                    className="w-full text-center text-[11px] text-white/50 hover:text-white"
                  >
                    {mode === "signin"
                      ? "First time here? Create the owner account →"
                      : "← Back to sign in"}
                  </button>
                </form>
              </>
            )}

            {attemptsLeft !== null && attemptsLeft < 5 && attemptsLeft > 0 && !locked && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> {attemptsLeft} attempt
                {attemptsLeft === 1 ? "" : "s"} left before temporary lockout.
              </div>
            )}

            <div className="mt-6 flex items-center justify-between text-[11px] text-white/40">
              <Link to="/" className="hover:text-white">
                ← Back to site
              </Link>
              <span>Monitored area</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}


/* ---------------- Dashboard ---------------- */

type TabKey =
  | "overview"
  | "toonhub"
  | "legends"
  | "pricing"
  | "explore"
  | "landings"
  | "portfolio"
  | "intruders";

const TABS: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "toonhub", label: "ToonHub Slides", icon: ImageIcon },
  { key: "legends", label: "Legends", icon: Sparkles },
  { key: "pricing", label: "Pricing Tiers", icon: DollarSign },
  { key: "explore", label: "Explore Projects", icon: Compass },
  { key: "landings", label: "Landing Pages", icon: Rocket },
  { key: "portfolio", label: "Portfolio Bio", icon: User },
  { key: "intruders", label: "Security / Intruders", icon: ShieldAlert },
];


function AdminDashboard({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<TabKey>("overview");
  const store = useContent();
  const navigate = useNavigate();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-content-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        store.update(data);
        alert("Content imported ✓");
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#08090f] via-[#0b0620] to-[#050510] text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/50 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-sky-500">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.3em] text-white/50">
                Portfolio OS · Admin
              </div>
              <div className="text-sm font-semibold">Command Center</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportJson}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            <label className="hidden sm:inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
              <Upload className="h-3.5 w-3.5" /> Import
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
              />
            </label>
            <button
              onClick={() => {
                if (confirm("Reset all content to defaults?")) store.reset();
              }}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-400/20"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
            <button
              onClick={() => navigate({ to: "/" })}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
            >
              View site
            </button>
            <button
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[240px_1fr]">
        {/* Sidebar */}
        <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`group inline-flex items-center gap-2.5 whitespace-nowrap rounded-xl border px-3 py-2.5 text-sm transition-all ${
                  active
                    ? "border-fuchsia-400/50 bg-gradient-to-r from-fuchsia-500/20 to-sky-500/20 text-white shadow-lg shadow-fuchsia-500/10"
                    : "border-white/10 bg-white/[0.02] text-white/60 hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <main className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              {tab === "overview" && <OverviewPanel />}
              {tab === "toonhub" && <ToonHubPanel />}
              {tab === "legends" && <LegendsPanel />}
              {tab === "pricing" && <PricingPanel />}
              {tab === "explore" && <ExplorePanel />}
              {tab === "landings" && <LandingsPanel />}
              {tab === "portfolio" && <PortfolioPanel />}
              {tab === "intruders" && <IntrudersPanel />}
              {tab === "privacy" && <PrivacyPanel />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

/* ---------------- Reusable primitives ---------------- */

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] uppercase tracking-[0.2em] text-white/50">
        {label}
      </span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-400 ${props.className ?? ""}`}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-400 ${props.className ?? ""}`}
    />
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2
          className="text-2xl font-black tracking-tight"
          style={{ fontFamily: "'Kanit', sans-serif" }}
        >
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-white/60">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function PrimaryBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-sky-500 px-3 py-2 text-xs font-semibold text-white shadow shadow-fuchsia-500/20 hover:opacity-90 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function DangerBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/20 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

/* ---------------- Overview ---------------- */

function OverviewPanel() {
  const { toonSlides, legends, pricing, projects, landings } = useContent();
  const stats = [
    {
      label: "ToonHub slides",
      value: toonSlides.length,
      color: "from-fuchsia-500 to-pink-500",
      to: "/",
    },
    {
      label: "Legends",
      value: legends.length,
      color: "from-amber-400 to-orange-500",
      to: "/legends",
    },
    {
      label: "Pricing tiers",
      value: pricing.length,
      color: "from-emerald-400 to-teal-500",
      to: "/portfolio#pricing",
    },
    {
      label: "Explore projects",
      value: projects.length,
      color: "from-sky-400 to-indigo-500",
      to: "/explore",
    },
    {
      label: "Custom landings",
      value: landings.length,
      color: "from-rose-400 to-fuchsia-500",
      to: "/admin",
    },
  ];
  return (
    <>
      <SectionHeader
        title="Welcome back, Eager Beaver."
        subtitle="Every change here saves instantly and takes effect across the live site."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden">
            <div
              className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${s.color} opacity-30 blur-2xl`}
            />
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/50">{s.label}</div>
            <div
              className="mt-2 text-5xl font-black tracking-tight"
              style={{ fontFamily: "'Kanit', sans-serif" }}
            >
              {s.value}
            </div>
          </Card>
        ))}
      </div>
      <Card className="mt-5">
        <h3 className="text-sm font-semibold">Quick actions</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to="/"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
          >
            Preview home
          </Link>
          <Link
            to="/explore"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
          >
            Preview Explore
          </Link>
          <Link
            to="/legends"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
          >
            Preview Legends
          </Link>
          <Link
            to="/portfolio"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
          >
            Preview Portfolio
          </Link>
        </div>
      </Card>
    </>
  );
}

/* ---------------- ToonHub Panel ---------------- */

function ToonHubPanel() {
  const { toonSlides, update } = useContent();
  const [draft, setDraft] = useState<ToonSlide>({ id: "", src: "", bg: "#111111", label: "" });

  const add = () => {
    if (!draft.src.trim() || !draft.label.trim()) return alert("Image URL and label required");
    const next: ToonSlide = { ...draft, id: `t_${Date.now()}` };
    update({ toonSlides: [...toonSlides, next] });
    setDraft({ id: "", src: "", bg: "#111111", label: "" });
  };
  const remove = (id: string) => update({ toonSlides: toonSlides.filter((s) => s.id !== id) });
  const patch = (id: string, p: Partial<ToonSlide>) =>
    update({ toonSlides: toonSlides.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  return (
    <>
      <SectionHeader
        title="ToonHub Slides"
        subtitle="These appear in the homepage carousel (after the built-in 10)."
      />
      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_1fr_auto]">
          <Field label="Image URL">
            <TextInput
              value={draft.src}
              onChange={(e) => setDraft({ ...draft, src: e.target.value })}
              placeholder="https://…/image.png"
            />
          </Field>
          <Field label="Background color">
            <TextInput
              type="color"
              value={draft.bg}
              onChange={(e) => setDraft({ ...draft, bg: e.target.value })}
              className="h-10 w-full cursor-pointer p-1"
            />
          </Field>
          <Field label="Label">
            <TextInput
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="e.g. Ninja Turtle"
            />
          </Field>
          <div className="flex items-end">
            <PrimaryBtn onClick={add}>
              <Plus className="h-3.5 w-3.5" /> Add slide
            </PrimaryBtn>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {toonSlides.map((s) => (
          <Card key={s.id} className="!p-3">
            <div className="aspect-video overflow-hidden rounded-lg" style={{ background: s.bg }}>
              {s.src && <img src={s.src} alt={s.label} className="h-full w-full object-contain" />}
            </div>
            <div className="mt-3 space-y-2">
              <TextInput value={s.label} onChange={(e) => patch(s.id, { label: e.target.value })} />
              <div className="flex gap-2">
                <TextInput
                  value={s.src}
                  onChange={(e) => patch(s.id, { src: e.target.value })}
                  className="flex-1"
                />
                <input
                  type="color"
                  value={s.bg}
                  onChange={(e) => patch(s.id, { bg: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-white/15 bg-black/40 p-0.5"
                />
              </div>
              <DangerBtn onClick={() => remove(s.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DangerBtn>
            </div>
          </Card>
        ))}
        {toonSlides.length === 0 && (
          <Card>
            <p className="text-sm text-white/50">
              No custom slides yet. The site still shows the 10 built-in ToonHub images.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}

/* ---------------- Legends Panel ---------------- */

function LegendsPanel() {
  const { legends, update } = useContent();
  const [openId, setOpenId] = useState<string | null>(null);

  const addLegend = () => {
    const slug = `legend-${Date.now()}`;
    const nl: Legend = {
      slug,
      title: "New Legend",
      kicker: "Fresh drop",
      tagline: "A short tagline.",
      story: "Your story here.",
      stack: ["React", "Motion"],
      image: "",
      accent: "#a855f7",
      bg: "#050510",
      animation: "smile",
      facts: [{ label: "Metric", value: "100%" }],
    };
    update({ legends: [nl, ...legends] });
    setOpenId(slug);
  };

  const patch = (slug: string, p: Partial<Legend>) =>
    update({ legends: legends.map((l) => (l.slug === slug ? { ...l, ...p } : l)) });
  const remove = (slug: string) => update({ legends: legends.filter((l) => l.slug !== slug) });

  return (
    <>
      <SectionHeader
        title="Legends"
        subtitle="Manage the cinematic looping landing pages."
        action={
          <PrimaryBtn onClick={addLegend}>
            <Plus className="h-3.5 w-3.5" /> Add Legend
          </PrimaryBtn>
        }
      />
      <div className="space-y-3">
        {legends.map((l) => {
          const isOpen = openId === l.slug;
          return (
            <Card key={l.slug} className="!p-0 overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? null : l.slug)}
                className="flex w-full items-center gap-4 p-4 text-left hover:bg-white/[0.03]"
              >
                <div
                  className="h-14 w-24 shrink-0 overflow-hidden rounded-lg"
                  style={{ background: l.bg }}
                >
                  {l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-widest" style={{ color: l.accent }}>
                    {l.kicker}
                  </div>
                  <div className="truncate text-lg font-semibold">{l.title}</div>
                  <div className="truncate text-xs text-white/50">{l.tagline}</div>
                </div>
                <div className="text-xs text-white/40">{isOpen ? "Close" : "Edit"}</div>
              </button>
              {isOpen && (
                <div className="border-t border-white/10 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Title">
                      <TextInput
                        value={l.title}
                        onChange={(e) => patch(l.slug, { title: e.target.value })}
                      />
                    </Field>
                    <Field label="Kicker">
                      <TextInput
                        value={l.kicker}
                        onChange={(e) => patch(l.slug, { kicker: e.target.value })}
                      />
                    </Field>
                    <Field label="Tagline">
                      <TextInput
                        value={l.tagline}
                        onChange={(e) => patch(l.slug, { tagline: e.target.value })}
                      />
                    </Field>
                    <Field label="Image URL">
                      <TextInput
                        value={l.image}
                        onChange={(e) => patch(l.slug, { image: e.target.value })}
                      />
                    </Field>
                    <Field label="Accent color">
                      <TextInput
                        type="color"
                        value={l.accent}
                        onChange={(e) => patch(l.slug, { accent: e.target.value })}
                        className="h-10 p-1"
                      />
                    </Field>
                    <Field label="Background color">
                      <TextInput
                        type="color"
                        value={l.bg}
                        onChange={(e) => patch(l.slug, { bg: e.target.value })}
                        className="h-10 p-1"
                      />
                    </Field>
                    <Field label="Stack (comma separated)">
                      <TextInput
                        value={l.stack.join(", ")}
                        onChange={(e) =>
                          patch(l.slug, {
                            stack: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                    <Field label="Animation">
                      <select
                        value={l.animation}
                        onChange={(e) =>
                          patch(l.slug, { animation: e.target.value as Legend["animation"] })
                        }
                        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm"
                      >
                        {[
                          "clash",
                          "smile",
                          "walk",
                          "mirror",
                          "ember",
                          "swing",
                          "eyeGlow",
                          "hoop",
                          "train",
                          "orbit",
                        ].map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Story">
                      <TextArea
                        rows={5}
                        value={l.story}
                        onChange={(e) => patch(l.slug, { story: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Link
                      to="/legends/$slug"
                      params={{ slug: l.slug }}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open landing page
                    </Link>
                    <DangerBtn
                      onClick={() => {
                        if (confirm(`Delete "${l.title}"?`)) remove(l.slug);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </DangerBtn>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- Pricing Panel ---------------- */

function PricingPanel() {
  const { pricing, update } = useContent();
  const patch = (id: string, p: Partial<PricingTier>) =>
    update({ pricing: pricing.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  const add = () => {
    const nt: PricingTier = {
      id: `tier_${Date.now()}`,
      name: "New Tier",
      price: "$0",
      weeks: "1 week",
      best: false,
      inc: ["Feature one", "Feature two"],
    };
    update({ pricing: [...pricing, nt] });
  };
  const remove = (id: string) => update({ pricing: pricing.filter((t) => t.id !== id) });

  return (
    <>
      <SectionHeader
        title="Pricing Tiers"
        subtitle="Shown in Portfolio → Investment section."
        action={
          <PrimaryBtn onClick={add}>
            <Plus className="h-3.5 w-3.5" /> Add tier
          </PrimaryBtn>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pricing.map((t) => (
          <Card key={t.id} className={t.best ? "border-fuchsia-400/50" : ""}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Tier</span>
              <label className="inline-flex items-center gap-1.5 text-[10px] text-white/60">
                <input
                  type="checkbox"
                  checked={t.best}
                  onChange={(e) => patch(t.id, { best: e.target.checked })}
                />{" "}
                Most popular
              </label>
            </div>
            <div className="mt-2 space-y-2">
              <Field label="Name">
                <TextInput value={t.name} onChange={(e) => patch(t.id, { name: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Price">
                  <TextInput
                    value={t.price}
                    onChange={(e) => patch(t.id, { price: e.target.value })}
                  />
                </Field>
                <Field label="Timeline">
                  <TextInput
                    value={t.weeks}
                    onChange={(e) => patch(t.id, { weeks: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Included features (one per line)">
                <TextArea
                  rows={5}
                  value={t.inc.join("\n")}
                  onChange={(e) =>
                    patch(t.id, {
                      inc: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <DangerBtn onClick={() => remove(t.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete tier
              </DangerBtn>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ---------------- Explore Panel ---------------- */

function ExplorePanel() {
  const { projects, update } = useContent();
  const [q, setQ] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      projects.filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q.toLowerCase()) ||
          p.category.toLowerCase().includes(q.toLowerCase()),
      ),
    [q, projects],
  );

  const patch = (slug: string, p: Partial<Project>) =>
    update({ projects: projects.map((x) => (x.slug === slug ? { ...x, ...p } : x)) });
  const add = () => {
    const slug = `project-${Date.now()}`;
    const np: Project = {
      slug,
      title: "New Project",
      category: "Business" as ProjectCategory,
      tagline: "One-line hook.",
      preview: "linear-gradient(135deg,#a855f7,#38bdf8)",
      accent: "#a855f7",
      problem: "",
      solution: "",
      stack: ["React"],
      features: ["Feature"],
      metrics: [{ label: "Users", value: "100" }],
      demo: "",
    };
    update({ projects: [np, ...projects] });
    setOpenSlug(slug);
  };
  const remove = (slug: string) => update({ projects: projects.filter((p) => p.slug !== slug) });
  const importZip = async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(file);
      const html = Object.keys(zip.files).find((name) => /(^|\/)index\.html$/i.test(name)) ?? Object.keys(zip.files).find((name) => /\.html$/i.test(name));
      const slug = file.name.replace(/\.zip$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `upload-${Date.now()}`;
      const np: Project = {
        slug,
        title: file.name.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
        category: "Business" as ProjectCategory,
        tagline: html ? "Uploaded website archive ready for a premium case-study page." : "Uploaded project archive added to Explore.",
        preview: "linear-gradient(135deg,#111827,#38bdf8)",
        accent: "#38bdf8",
        problem: "This project was uploaded from a website ZIP and can now be shaped into a full portfolio case study from the admin dashboard.",
        solution: "The portfolio instantly creates an Explore item and landing page entry point so visitors can discover, search, and open the project.",
        stack: ["Uploaded ZIP", "Website", "Portfolio"],
        features: ["Archive imported", "Landing page generated", "Searchable case study"],
        metrics: [{ label: "Files", value: String(Object.keys(zip.files).length) }],
        demo: "",
      };
      update({ projects: [np, ...projects.filter((p) => p.slug !== slug)] });
      setOpenSlug(slug);
    } catch {
      alert("Could not read that ZIP file.");
    }
  };

  return (
    <>
      <SectionHeader
        title="Explore Projects"
        subtitle={`${projects.length} projects powering the /explore grid.`}
        action={
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              <Upload className="h-3.5 w-3.5" /> Upload ZIP
              <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => e.target.files?.[0] && importZip(e.target.files[0])} />
            </label>
            <PrimaryBtn onClick={add}>
              <Plus className="h-3.5 w-3.5" /> New project
            </PrimaryBtn>
          </div>
        }
      />
      <Card className="mb-4">
        <TextInput
          placeholder="Search by title or category…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Card>
      <div className="space-y-2">
        {filtered.map((p) => {
          const isOpen = openSlug === p.slug;
          return (
            <Card key={p.slug} className="!p-0">
              <button
                onClick={() => setOpenSlug(isOpen ? null : p.slug)}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-white/[0.03]"
              >
                <div className="h-12 w-20 shrink-0 rounded-md" style={{ background: p.preview }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/60">
                      {p.category}
                    </span>
                    <span className="truncate text-sm font-semibold">{p.title}</span>
                  </div>
                  <div className="truncate text-xs text-white/50">{p.tagline}</div>
                </div>
                <span className="text-xs text-white/40">{isOpen ? "Close" : "Edit"}</span>
              </button>
              {isOpen && (
                <div className="border-t border-white/10 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Title">
                      <TextInput
                        value={p.title}
                        onChange={(e) => patch(p.slug, { title: e.target.value })}
                      />
                    </Field>
                    <Field label="Category">
                      <select
                        value={p.category}
                        onChange={(e) =>
                          patch(p.slug, { category: e.target.value as ProjectCategory })
                        }
                        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Tagline">
                      <TextInput
                        value={p.tagline}
                        onChange={(e) => patch(p.slug, { tagline: e.target.value })}
                      />
                    </Field>
                    <Field label="Accent color">
                      <TextInput
                        type="color"
                        value={p.accent}
                        onChange={(e) => patch(p.slug, { accent: e.target.value })}
                        className="h-10 p-1"
                      />
                    </Field>
                    <Field label="Preview (CSS gradient / URL)">
                      <TextInput
                        value={p.preview}
                        onChange={(e) => patch(p.slug, { preview: e.target.value })}
                      />
                    </Field>
                    <Field label="Demo link">
                      <TextInput
                        value={p.demo}
                        onChange={(e) => patch(p.slug, { demo: e.target.value })}
                        placeholder="https://…"
                      />
                    </Field>
                    <Field label="Stack (comma separated)">
                      <TextInput
                        value={p.stack.join(", ")}
                        onChange={(e) =>
                          patch(p.slug, {
                            stack: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                    <Field label="Features (comma separated)">
                      <TextInput
                        value={p.features.join(", ")}
                        onChange={(e) =>
                          patch(p.slug, {
                            features: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label="Problem">
                      <TextArea
                        rows={3}
                        value={p.problem}
                        onChange={(e) => patch(p.slug, { problem: e.target.value })}
                      />
                    </Field>
                    <Field label="Solution">
                      <TextArea
                        rows={3}
                        value={p.solution}
                        onChange={(e) => patch(p.slug, { solution: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Link
                      to="/explore"
                      className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> View in Explore
                    </Link>
                    <DangerBtn
                      onClick={() => {
                        if (confirm(`Delete "${p.title}"?`)) remove(p.slug);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </DangerBtn>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- Landings Panel ---------------- */

function LandingsPanel() {
  const { landings, update } = useContent();
  const [draft, setDraft] = useState<CustomLanding>({
    slug: "",
    title: "",
    kicker: "",
    tagline: "",
    body: "",
    image: "",
    accent: "#a855f7",
    bg: "#050510",
    ctaLabel: "Learn more",
    ctaHref: "",
  });

  const add = () => {
    const slug = (draft.slug || draft.title)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug || !draft.title.trim() || !draft.ctaHref.trim())
      return alert("Slug, title and CTA link required");
    if (landings.some((l) => l.slug === slug)) return alert("Slug already exists");
    update({ landings: [...landings, { ...draft, slug }] });
    setDraft({
      slug: "",
      title: "",
      kicker: "",
      tagline: "",
      body: "",
      image: "",
      accent: "#a855f7",
      bg: "#050510",
      ctaLabel: "Learn more",
      ctaHref: "",
    });
  };
  const patch = (slug: string, p: Partial<CustomLanding>) =>
    update({ landings: landings.map((l) => (l.slug === slug ? { ...l, ...p } : l)) });
  const remove = (slug: string) => update({ landings: landings.filter((l) => l.slug !== slug) });

  return (
    <>
      <SectionHeader
        title="Custom Landing Pages"
        subtitle="Just paste a link, title and a short pitch — a full landing page ships instantly at /landing/[slug]."
      />

      <Card className="mb-5">
        <h3 className="mb-3 text-sm font-semibold">Create new landing page</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Title">
            <TextInput
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Aurora Studio"
            />
          </Field>
          <Field label="Slug (URL-safe)">
            <TextInput
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder="auto from title if empty"
            />
          </Field>
          <Field label="Kicker">
            <TextInput
              value={draft.kicker}
              onChange={(e) => setDraft({ ...draft, kicker: e.target.value })}
              placeholder="Now live"
            />
          </Field>
          <Field label="Tagline">
            <TextInput
              value={draft.tagline}
              onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
              placeholder="One-line hook"
            />
          </Field>
          <Field label="Hero image URL">
            <TextInput
              value={draft.image}
              onChange={(e) => setDraft({ ...draft, image: e.target.value })}
              placeholder="https://…"
            />
          </Field>
          <Field label="CTA link (deep-link)">
            <TextInput
              value={draft.ctaHref}
              onChange={(e) => setDraft({ ...draft, ctaHref: e.target.value })}
              placeholder="/explore or https://…"
            />
          </Field>
          <Field label="CTA label">
            <TextInput
              value={draft.ctaLabel}
              onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Accent">
              <TextInput
                type="color"
                value={draft.accent}
                onChange={(e) => setDraft({ ...draft, accent: e.target.value })}
                className="h-10 p-1"
              />
            </Field>
            <Field label="Background">
              <TextInput
                type="color"
                value={draft.bg}
                onChange={(e) => setDraft({ ...draft, bg: e.target.value })}
                className="h-10 p-1"
              />
            </Field>
          </div>
        </div>
        <div className="mt-3">
          <Field label="Body / pitch">
            <TextArea
              rows={4}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="A few paragraphs about what this page showcases…"
            />
          </Field>
        </div>
        <div className="mt-4">
          <PrimaryBtn onClick={add}>
            <Rocket className="h-3.5 w-3.5" /> Publish landing page
          </PrimaryBtn>
        </div>
      </Card>

      <div className="space-y-3">
        {landings.map((l) => (
          <Card key={l.slug}>
            <div className="flex items-start gap-4">
              <div
                className="h-16 w-24 shrink-0 overflow-hidden rounded-lg"
                style={{ background: l.bg }}
              >
                {l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-widest" style={{ color: l.accent }}>
                  {l.kicker || "Landing"}
                </div>
                <div className="truncate text-lg font-semibold">{l.title}</div>
                <div className="truncate text-xs text-white/50">
                  /landing/{l.slug} → {l.ctaHref}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Link
                  to="/landing/$slug"
                  params={{ slug: l.slug }}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </Link>
                <DangerBtn onClick={() => remove(l.slug)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DangerBtn>
              </div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-white/60 hover:text-white">
                Edit
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Title">
                  <TextInput
                    value={l.title}
                    onChange={(e) => patch(l.slug, { title: e.target.value })}
                  />
                </Field>
                <Field label="Kicker">
                  <TextInput
                    value={l.kicker}
                    onChange={(e) => patch(l.slug, { kicker: e.target.value })}
                  />
                </Field>
                <Field label="Tagline">
                  <TextInput
                    value={l.tagline}
                    onChange={(e) => patch(l.slug, { tagline: e.target.value })}
                  />
                </Field>
                <Field label="Image URL">
                  <TextInput
                    value={l.image}
                    onChange={(e) => patch(l.slug, { image: e.target.value })}
                  />
                </Field>
                <Field label="CTA link">
                  <TextInput
                    value={l.ctaHref}
                    onChange={(e) => patch(l.slug, { ctaHref: e.target.value })}
                  />
                </Field>
                <Field label="CTA label">
                  <TextInput
                    value={l.ctaLabel}
                    onChange={(e) => patch(l.slug, { ctaLabel: e.target.value })}
                  />
                </Field>
                <Field label="Accent">
                  <TextInput
                    type="color"
                    value={l.accent}
                    onChange={(e) => patch(l.slug, { accent: e.target.value })}
                    className="h-10 p-1"
                  />
                </Field>
                <Field label="Background">
                  <TextInput
                    type="color"
                    value={l.bg}
                    onChange={(e) => patch(l.slug, { bg: e.target.value })}
                    className="h-10 p-1"
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Body">
                  <TextArea
                    rows={4}
                    value={l.body}
                    onChange={(e) => patch(l.slug, { body: e.target.value })}
                  />
                </Field>
              </div>
            </details>
          </Card>
        ))}
        {landings.length === 0 && (
          <Card>
            <p className="text-sm text-white/50">No custom landing pages yet.</p>
          </Card>
        )}
      </div>
    </>
  );
}

/* ---------------- Portfolio Bio Panel ---------------- */

function PortfolioPanel() {
  const { bio, update } = useContent();
  const patch = (p: Partial<typeof bio>) => update({ bio: { ...bio, ...p } });
  return (
    <>
      <SectionHeader
        title="Portfolio Bio"
        subtitle="Personal details shown across the portfolio and contact areas."
      />
      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Full name">
            <TextInput value={bio.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Nickname">
            <TextInput value={bio.nickname} onChange={(e) => patch({ nickname: e.target.value })} />
          </Field>
          <Field label="Headline">
            <TextInput value={bio.headline} onChange={(e) => patch({ headline: e.target.value })} />
          </Field>
          <Field label="Location">
            <TextInput value={bio.location} onChange={(e) => patch({ location: e.target.value })} />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={bio.email}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <TextInput value={bio.phone} onChange={(e) => patch({ phone: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Short bio">
            <TextArea rows={4} value={bio.bio} onChange={(e) => patch({ bio: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-white/50">
          <Save className="h-3.5 w-3.5" /> Changes save automatically.
        </div>
      </Card>
    </>
  );
}

/* ---------------- Intruders / Security panel ---------------- */

function IntrudersPanel() {
  const [records, setRecords] = useState<IntruderRow[]>([]);
  const [preview, setPreview] = useState<IntruderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useServerFn(listIntruders);
  const doDelete = useServerFn(deleteIntruderRecord);
  const doClear = useServerFn(clearAllIntruders);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchList();
      setRecords(res.records as IntruderRow[]);
    } catch {
      setError("Could not load captured intruders.");
    }
    setLoading(false);
  }, [fetchList]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const removeOne = async (id: string) => {
    await doDelete({ data: { id } });
    setRecords((rs) => rs.filter((r) => r.id !== id));
  };
  const clearAll = async () => {
    if (window.confirm("Delete all captured intruder records?")) {
      await doClear();
      setRecords([]);
    }
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>
            Security · Captured intruders
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Anyone who fails the security questions or enters wrong credentials on the admin sign-in
            is photographed (if they granted camera access) and logged to your cloud dashboard —
            viewable from any device.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Refresh
          </button>
          {records.length > 0 && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading captures…
          </div>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center text-white/50">
            <ShieldCheck className="h-10 w-10 text-emerald-400" />
            <p className="text-sm">No intrusion attempts recorded. Your admin panel is secure.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {records.map((r) => (
            <Card key={r.id} className="p-0 overflow-hidden">
              <button
                onClick={() => r.photo && setPreview(r)}
                className="relative block aspect-[4/3] w-full bg-black/60"
              >
                {r.photo ? (
                  <img
                    src={r.photo}
                    alt="Captured intruder"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/40">
                    <CameraOff className="h-8 w-8" />
                    <span className="text-[11px]">Camera was blocked</span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Intruder
                </span>
              </button>
              <div className="p-4">
                <div className="text-xs font-semibold text-red-300">{r.reason}</div>
                <div className="mt-2 space-y-1 text-[11px] text-white/50">
                  <div>🕒 {new Date(r.created_at).toLocaleString()}</div>
                  <div>👤 Tried: {r.username_tried}</div>
                  <div>🌐 IP: {r.ip || "unknown"}</div>
                  <div>🌍 {r.timezone || "unknown"}</div>
                  <div className="truncate" title={r.user_agent ?? ""}>
                    💻 {r.platform || "?"} · {r.screen}
                  </div>
                </div>
                <button
                  onClick={() => removeOne(r.id)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AnimatePresence>
        {preview?.photo && (
          <div
            className="fixed inset-0 z-[400] flex items-center justify-center bg-black/85 p-4 backdrop-blur-xl"
            onClick={() => setPreview(null)}
          >
            <motion.img
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              src={preview.photo}
              alt="Captured intruder"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] max-w-3xl rounded-2xl border border-white/20 shadow-2xl"
            />
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ---------------- Privacy controls panel ---------------- */

const RETENTION_OPTIONS = [
  { value: 0, label: "Never delete" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

function PrivacyPanel() {
  const [autoDelete, setAutoDelete] = useState(false);
  const [retentionDays, setRetentionDays] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchSettings = useServerFn(getPrivacySettings);
  const saveSettings = useServerFn(updatePrivacySettings);
  const doPurge = useServerFn(purgeExpiredNow);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((s) => {
        if (cancelled) return;
        setAutoDelete(s.autoDelete);
        setRetentionDays(s.retentionDays);
        setUpdatedAt(s.updatedAt);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await saveSettings({ data: { retentionDays, autoDelete } });
      setUpdatedAt(new Date().toISOString());
      setMsg("Privacy settings saved ✓");
    } catch {
      setMsg("Could not save settings.");
    }
    setSaving(false);
  };

  const purgeNow = async () => {
    if (retentionDays <= 0) {
      setMsg("Set a retention period first, then purge.");
      return;
    }
    if (!window.confirm(`Delete all captures older than ${retentionDays} days now?`)) return;
    setPurging(true);
    setMsg(null);
    try {
      const res = await doPurge();
      setMsg(`Purged ${res.deleted} old capture${res.deleted === 1 ? "" : "s"} ✓`);
    } catch {
      setMsg("Could not purge now.");
    }
    setPurging(false);
  };

  return (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>
          Privacy controls
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Automatically delete captured intruder media after a retention period. Purging runs daily
          in the cloud and removes photos plus their metadata permanently.
        </p>
      </div>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <label className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Trash2 className="h-4 w-4 text-fuchsia-300" /> Auto-delete old captures
              </span>
              <button
                type="button"
                onClick={() => setAutoDelete((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  autoDelete ? "bg-emerald-500" : "bg-white/20"
                }`}
                aria-pressed={autoDelete}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    autoDelete ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
            <p className="mt-2 text-[11px] text-white/40">
              When on, captures older than the retention period are deleted automatically every day.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-sky-300" /> Retention period
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {RETENTION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRetentionDays(opt.value)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                    retentionDays === opt.value
                      ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-white"
                      : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {retentionDays === 0 && (
              <p className="mt-3 text-[11px] text-amber-300/80">
                Retention is set to “Never” — nothing will be auto-deleted until you choose a period.
              </p>
            )}
          </Card>

          {msg && (
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70">
              {msg}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-sky-500 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-fuchsia-500/30 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save settings
            </button>
            <button
              onClick={purgeNow}
              disabled={purging || retentionDays <= 0}
              className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              {purging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Purge expired now
            </button>
            {updatedAt && (
              <span className="text-[11px] text-white/40">
                Last updated {new Date(updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}


