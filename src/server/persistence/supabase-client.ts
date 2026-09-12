/**
 * Space Zero — server-side Supabase client (service role).
 *
 * SERVER ONLY. This module reads SUPABASE_SERVICE_ROLE_KEY, which bypasses Row
 * Level Security and must NEVER reach the browser. It is imported only by the
 * SupabaseTripRepository, which is used only inside server routes. Do not import
 * this from any "use client" module.
 *
 * When user auth (WebAuthn) lands, per-request user-scoped clients using the
 * anon key + a verified session should replace service-role access for
 * user-facing reads/writes, and RLS policies become the enforcement boundary.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  // Accept the new-style Supabase secret key (SUPABASE_SECRET_KEY, e.g.
  // "sb_secret_…") and fall back to the legacy service-role JWT name. Both bypass
  // RLS and must stay server-only.
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY (server-only).",
    );
  }
  if (!client) {
    client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
