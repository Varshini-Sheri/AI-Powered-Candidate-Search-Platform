"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The browser only ever holds the Supabase URL and the publishable key, both
// designed to be public. Data access is guarded by RLS on the server side.
let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}
