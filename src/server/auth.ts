import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";
import { userClient } from "./supabase";

export interface Recruiter {
  userId: string;
  db: SupabaseClient;
}

/** Validates the Bearer token and returns a database client acting as that recruiter. */
export async function requireRecruiter(req: Request): Promise<Recruiter> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpError(401, "unauthorized", "Sign in required.");
  const token = m[1].trim();
  const db = userClient(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized", "Your session has expired. Sign in again.");
  return { userId: data.user.id, db };
}
