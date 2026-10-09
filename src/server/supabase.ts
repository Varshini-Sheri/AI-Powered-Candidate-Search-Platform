import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

/** A client that acts as the signed-in recruiter, so RLS applies to every query. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(serverEnv.supabaseUrl(), serverEnv.publishableKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Service-role client. Used only by the Stripe webhook route. */
export function serviceClient(): SupabaseClient {
  return createClient(serverEnv.supabaseUrl(), serverEnv.secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
