// Admin security gate: security questions + intruder photo capture.
// All data is stored locally in the browser (localStorage) so the owner can
// review capture attempts inside the admin dashboard.

export type IntruderRecord = {
  id: string;
  at: number; // epoch ms
  reason: string; // what they got wrong
  usernameTried: string;
  photo: string | null; // dataURL (JPEG) or null if camera was blocked
  userAgent: string;
  language: string;
  platform: string;
  screen: string;
  timezone: string;
};

const INTRUDER_KEY = "portfolio-intruders";
const MAX_RECORDS = 60;

/* ---------------- Security questions ---------------- */

export type SecurityQuestion = { id: string; question: string; answer: string };

// Owner-known answers. Comparison is case-insensitive and trimmed.
export const SECURITY_QUESTIONS: SecurityQuestion[] = [
  { id: "q1", question: "What is the owner's studio codename?", answer: "eager beaver" },
  { id: "q2", question: "What year did the owner start coding?", answer: "2019" },
];

export function checkSecurityAnswers(answers: Record<string, string>): boolean {
  return SECURITY_QUESTIONS.every(
    (q) => (answers[q.id] ?? "").trim().toLowerCase() === q.answer.trim().toLowerCase(),
  );
}

/* ---------------- Intruder log ---------------- */

export function getIntruders(): IntruderRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(INTRUDER_KEY);
    return raw ? (JSON.parse(raw) as IntruderRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveIntruder(rec: IntruderRecord) {
  if (typeof window === "undefined") return;
  const all = [rec, ...getIntruders()].slice(0, MAX_RECORDS);
  try {
    window.localStorage.setItem(INTRUDER_KEY, JSON.stringify(all));
  } catch {
    // storage full — drop oldest photos and retry once
    const trimmed = all.slice(0, 20);
    try {
      window.localStorage.setItem(INTRUDER_KEY, JSON.stringify(trimmed));
    } catch {
      /* give up silently */
    }
  }
}

export function clearIntruders() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(INTRUDER_KEY);
}

export function deleteIntruder(id: string) {
  if (typeof window === "undefined") return;
  const next = getIntruders().filter((r) => r.id !== id);
  window.localStorage.setItem(INTRUDER_KEY, JSON.stringify(next));
}

/* ---------------- Camera capture ---------------- */

let sharedStream: MediaStream | null = null;

// Request camera access up front so the browser shows the permission prompt as
// soon as the admin panel opens.
export async function requestCamera(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  if (sharedStream) return sharedStream;
  try {
    sharedStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    return sharedStream;
  } catch {
    return null;
  }
}

export function stopCamera() {
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
}

// Grab a single frame from the shared stream and return it as a JPEG dataURL.
export async function capturePhoto(): Promise<string | null> {
  const stream = sharedStream ?? (await requestCamera());
  if (!stream) return null;
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // let the sensor warm up for a stable frame
    await new Promise((r) => setTimeout(r, 350));
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    video.pause();
    video.srcObject = null;
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

export async function recordIntruder(reason: string, usernameTried: string) {
  const photo = await capturePhoto();
  const rec: IntruderRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    reason,
    usernameTried,
    photo,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    language: typeof navigator !== "undefined" ? navigator.language : "",
    platform: typeof navigator !== "undefined" ? (navigator.platform ?? "") : "",
    screen: typeof window !== "undefined" ? `${window.screen.width}×${window.screen.height}` : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
  };
  saveIntruder(rec);
  return rec;
}
