import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ---------------- Config ---------------- */

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function clientIdentifier(fallback: string): string {
  const ip = getRequestIP({ xForwardedFor: true });
  return (ip && ip.trim()) || fallback || "unknown";
}

/* ---------------- Intruder logging (public) ---------------- */

export const logIntruder = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      reason: z.string().max(200),
      usernameTried: z.string().max(200),
      photo: z.string().max(4_000_000).nullable(),
      userAgent: z.string().max(1000).default(""),
      language: z.string().max(100).default(""),
      platform: z.string().max(200).default(""),
      screen: z.string().max(50).default(""),
      timezone: z.string().max(100).default(""),
      deviceId: z.string().max(100).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = clientIdentifier(data.deviceId);
    const { error } = await supabaseAdmin.from("intruder_events").insert({
      reason: data.reason,
      username_tried: data.usernameTried,
      photo: data.photo,
      ip,
      user_agent: data.userAgent,
      language: data.language,
      platform: data.platform,
      screen: data.screen,
      timezone: data.timezone,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Brute-force lockout (public) ---------------- */

export const checkAdminLockout = createServerFn({ method: "POST" })
  .inputValidator(z.object({ deviceId: z.string().max(100).default("") }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const identifier = clientIdentifier(data.deviceId);
    const { data: row } = await supabaseAdmin
      .from("admin_login_attempts")
      .select("fail_count, locked_until")
      .eq("identifier", identifier)
      .maybeSingle();

    const now = Date.now();
    const lockedUntil = row?.locked_until ? new Date(row.locked_until).getTime() : 0;
    if (lockedUntil > now) {
      return {
        locked: true,
        lockedUntil: new Date(lockedUntil).toISOString(),
        secondsLeft: Math.ceil((lockedUntil - now) / 1000),
        attemptsRemaining: 0,
      };
    }
    return {
      locked: false,
      lockedUntil: null,
      secondsLeft: 0,
      attemptsRemaining: Math.max(0, MAX_FAILS - (row?.fail_count ?? 0)),
    };
  });

export const recordAdminFailure = createServerFn({ method: "POST" })
  .inputValidator(z.object({ deviceId: z.string().max(100).default("") }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const identifier = clientIdentifier(data.deviceId);
    const now = Date.now();

    const { data: row } = await supabaseAdmin
      .from("admin_login_attempts")
      .select("fail_count, locked_until")
      .eq("identifier", identifier)
      .maybeSingle();

    const lockedUntil = row?.locked_until ? new Date(row.locked_until).getTime() : 0;
    if (lockedUntil > now) {
      return {
        locked: true,
        lockedUntil: new Date(lockedUntil).toISOString(),
        secondsLeft: Math.ceil((lockedUntil - now) / 1000),
        attemptsRemaining: 0,
      };
    }

    const newCount = (row?.fail_count ?? 0) + 1;
    const shouldLock = newCount >= MAX_FAILS;
    const nextLockedUntil = shouldLock ? new Date(now + LOCK_MINUTES * 60_000) : null;

    await supabaseAdmin.from("admin_login_attempts").upsert(
      {
        identifier,
        fail_count: shouldLock ? 0 : newCount,
        locked_until: nextLockedUntil ? nextLockedUntil.toISOString() : null,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "identifier" },
    );

    return {
      locked: shouldLock,
      lockedUntil: nextLockedUntil ? nextLockedUntil.toISOString() : null,
      secondsLeft: shouldLock ? LOCK_MINUTES * 60 : 0,
      attemptsRemaining: Math.max(0, MAX_FAILS - newCount),
    };
  });

export const clearAdminFailures = createServerFn({ method: "POST" })
  .inputValidator(z.object({ deviceId: z.string().max(100).default("") }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const identifier = clientIdentifier(data.deviceId);
    await supabaseAdmin.from("admin_login_attempts").delete().eq("identifier", identifier);
    return { ok: true };
  });

/* ---------------- Admin role (authenticated) ---------------- */

export const claimAdminIfUnclaimed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if ((count ?? 0) === 0) {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: context.userId, role: "admin" });
      return { claimed: true, isAdmin: true };
    }

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { claimed: false, isAdmin: Boolean(isAdmin) };
  });

export const getMyAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: Boolean(isAdmin) };
  });

/* ---------------- Intruder review (admin only) ---------------- */

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

export const listIntruders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("intruder_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { records: data ?? [] };
  });

export const deleteIntruderRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("intruder_events")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearAllIntruders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("intruder_events")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Privacy settings (admin only) ---------------- */

export const getPrivacySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("privacy_settings")
      .select("retention_days, auto_delete, updated_at")
      .eq("id", "global")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      retentionDays: data?.retention_days ?? 0,
      autoDelete: data?.auto_delete ?? false,
      updatedAt: data?.updated_at ?? null,
    };
  });

export const updatePrivacySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      retentionDays: z.number().int().min(0).max(3650),
      autoDelete: z.boolean(),
    }),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("privacy_settings")
      .update({
        retention_days: data.retentionDays,
        auto_delete: data.autoDelete,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "global");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const purgeExpiredNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings } = await supabaseAdmin
      .from("privacy_settings")
      .select("retention_days")
      .eq("id", "global")
      .maybeSingle();
    const days = settings?.retention_days ?? 0;
    if (days <= 0) return { deleted: 0, retentionDays: 0 };
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("intruder_events")
      .delete()
      .lt("created_at", cutoff)
      .select("id");
    if (error) throw new Error(error.message);
    return { deleted: data?.length ?? 0, retentionDays: days };
  });
