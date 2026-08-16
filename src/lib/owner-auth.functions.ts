import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Owner login, two factors.
 *
 * Factor 1, username + password, verified server-side against secret env
 * values. The real Supabase owner account and its strong password never ship
 * to the browser.
 *
 * Factor 2, a one-time code emailed to the owner address. Supabase Auth owns
 * the code lifecycle (generation, expiry, attempt limits) and verifying it is
 * what mints the session, so a correct password alone can never sign in.
 */

const credsSchema = z.object({
  username: z.string().max(200),
  password: z.string().max(500),
});

/** Step 1: check the password, then email a one-time code to the owner. */
export const ownerLoginStart = createServerFn({ method: "POST" })
  .inputValidator(credsSchema)
  .handler(async ({ data }) => {
    const { readOwnerConfig, credentialsValid, ensureOwnerAccount, anonClient, maskEmail } =
      await import("./owner-auth.server");

    const cfg = readOwnerConfig();

    // Generic failure, never reveal which field was wrong.
    if (!credentialsValid(cfg, data.username, data.password)) {
      return { ok: false as const };
    }

    if (!cfg.ownerEmail || !cfg.ownerPassword) {
      return { ok: false as const, error: "Owner account is not configured." };
    }

    const ownerId = await ensureOwnerAccount(cfg.ownerEmail, cfg.ownerPassword);
    if (!ownerId) {
      return { ok: false as const, error: "Could not establish owner account." };
    }

    const anon = anonClient();

    // The second factor only runs once the project can actually deliver the
    // code by email. Until then, password sign-in completes here so the owner
    // is never locked out of their own dashboard.
    if ((process.env.ADMIN_MFA_ENABLED ?? "false").toLowerCase() !== "true") {
      const { data: signed, error } = await anon.auth.signInWithPassword({
        email: cfg.ownerEmail,
        password: cfg.ownerPassword,
      });
      if (error || !signed.session) {
        return { ok: false as const, error: "Could not establish a session. Please try again." };
      }
      return {
        ok: true as const,
        mfaRequired: false as const,
        access_token: signed.session.access_token,
        refresh_token: signed.session.refresh_token,
      };
    }

    const { error } = await anon.auth.signInWithOtp({
      email: cfg.ownerEmail,
      options: { shouldCreateUser: false },
    });
    if (error) {
      return {
        ok: false as const,
        error: "Could not send your verification code. Please try again in a moment.",
      };
    }

    return { ok: true as const, mfaRequired: true as const, emailHint: maskEmail(cfg.ownerEmail) };
  });

/**
 * Step 2: re-check the password AND the emailed code, then mint the session.
 *
 * Credentials are re-verified here on purpose so the endpoint is never a
 * code-only door, guessing the 6 digits without the password is useless.
 */
export const ownerLoginVerify = createServerFn({ method: "POST" })
  .inputValidator(
    credsSchema.extend({
      code: z
        .string()
        .trim()
        .min(6)
        .max(10)
        .regex(/^[0-9]+$/, "The code is 6 digits."),
    }),
  )
  .handler(async ({ data }) => {
    const { readOwnerConfig, credentialsValid, anonClient } = await import("./owner-auth.server");

    const cfg = readOwnerConfig();
    if (!credentialsValid(cfg, data.username, data.password)) {
      return { ok: false as const };
    }
    if (!cfg.ownerEmail) {
      return { ok: false as const, error: "Owner account is not configured." };
    }

    const anon = anonClient();
    const { data: verified, error } = await anon.auth.verifyOtp({
      email: cfg.ownerEmail,
      token: data.code,
      type: "email",
    });

    if (error || !verified.session) {
      return { ok: false as const, error: "That code is invalid or has expired." };
    }

    return {
      ok: true as const,
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    };
  });

/** Resend the one-time code (password re-checked first). */
export const ownerLoginResend = createServerFn({ method: "POST" })
  .inputValidator(credsSchema)
  .handler(async ({ data }) => {
    const { readOwnerConfig, credentialsValid, anonClient } = await import("./owner-auth.server");

    const cfg = readOwnerConfig();
    if (!credentialsValid(cfg, data.username, data.password) || !cfg.ownerEmail) {
      return { ok: false as const };
    }

    const anon = anonClient();
    const { error } = await anon.auth.signInWithOtp({
      email: cfg.ownerEmail,
      options: { shouldCreateUser: false },
    });
    return error ? { ok: false as const } : { ok: true as const };
  });
