// Loads .env.local (written by `npm run env:write`) for scripts and tests.
// Values already set in the shell win, matching Next.js behaviour.
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

export function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^"(.*)"$/, "$1");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run \`make setup\` first.`);
  return v;
}

export function serviceClient() {
  loadEnv();
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient() {
  loadEnv();
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const RECRUITERS = {
  acme: { email: "recruiter@acme.test", password: "rotto-assessment" },
  globex: { email: "recruiter@globex.test", password: "rotto-assessment" },
} as const;
