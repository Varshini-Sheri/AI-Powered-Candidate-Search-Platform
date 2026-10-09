"use client";
import { browserSupabase } from "@/lib/supabase-browser";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Calls our API with the recruiter's access token as a Bearer header. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const { data } = await browserSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "unauthorized", "Your session has ended. Sign in again.");
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) await browserSupabase().auth.signOut();
    throw new ApiError(res.status, body.error ?? "error", body.message ?? "Something went wrong.");
  }
  return body as T;
}
