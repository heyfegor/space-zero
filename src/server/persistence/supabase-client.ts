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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only).",
    );
  }
  if (!client) {
    client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
