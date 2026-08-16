import { createClient } from "@supabase/supabase-js";

/**
 * Server-only helpers for the owner (admin) login flow.
 *
 * Never import this from a component or from the module scope of a
 * *.functions.ts file, load it inside a server function handler with
 * `await import("./owner-auth.server")`.
 */

export type OwnerConfig = {
  expectedUser: string;
  accepted: string[];
  ownerEmail: string;
  ownerPassword: string;
};

export function readOwnerConfig(): OwnerConfig {
  return {
    expectedUser: (process.env.OWNER_LOGIN_USERNAME ?? "").trim(),
    accepted: (process.env.OWNER_LOGIN_PASSWORDS ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    ownerEmail: (process.env.OWNER_ACCOUNT_EMAIL ?? "").trim(),
    ownerPassword: process.env.OWNER_ACCOUNT_PASSWORD ?? "",
  };
}

/** First factor: username + password, checked against server-only secrets. */
export function credentialsValid(cfg: OwnerConfig, username: string, password: string): boolean {
  const userOk =
    cfg.expectedUser.length > 0 &&
    username.trim().toLowerCase() === cfg.expectedUser.toLowerCase();
  const passOk = cfg.accepted.includes(password);
  return userOk && passOk;
}

/** Publishable-key client used to send / verify the email OTP. */
export function anonClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Make sure the real Supabase owner account exists, has the strong password
 * from secrets, and holds the admin role. Returns the owner user id.
 */
export async function ensureOwnerAccount(
  ownerEmail: string,
  ownerPassword: string,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let ownerId: string | null = null;
  try {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (created.data.user) ownerId = created.data.user.id;
  } catch {
    /* already exists, fall through to lookup */
  }

  if (!ownerId) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = list?.users.find(
      (u) => (u.email ?? "").toLowerCase() === ownerEmail.toLowerCase(),
    );
    if (found) {
      ownerId = found.id;
      await supabaseAdmin.auth.admin.updateUserById(found.id, {
        password: ownerPassword,
        email_confirm: true,
      });
    }
  }

  if (!ownerId) return null;

  const { data: hasRole } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("user_id", ownerId)
    .eq("role", "admin")
    .maybeSingle();
  if (!hasRole) {
    await supabaseAdmin.from("user_roles").insert({ user_id: ownerId, role: "admin" });
  }

  return ownerId;
}

/** "owner@example.com" -> "o•••r@example.com" for a safe on-screen hint. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your email";
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : "";
  return `${head}${"•".repeat(Math.max(1, local.length - 2))}${tail}@${domain}`;
}
