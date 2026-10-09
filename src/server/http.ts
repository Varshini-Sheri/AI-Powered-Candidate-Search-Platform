import "server-only";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Map database errors to HTTP errors. Function errors carry a known message. */
export function fromDb(error: { message?: string; code?: string } | null): HttpError | null {
  if (!error) return null;
  const m = error.message ?? "";
  if (m.includes("quota_exhausted")) return new HttpError(402, "quota_exhausted", "No searches left on the free plan.");
  if (m.includes("search_not_found")) return new HttpError(404, "not_found", "Search not found.");
  if (m.includes("not_a_recruiter")) return new HttpError(403, "forbidden", "Not a recruiter.");
  if (m.includes("no_required")) return new HttpError(422, "no_required", "Add at least one required filter.");
  if (m.includes("reservation_expired") || m.includes("search_not_pending")) return new HttpError(409, "conflict", "This search expired. Please try again.");
  if (error.code === "23505") return new HttpError(409, "conflict", "That name is already taken.");
  if (error.code === "42501" || error.code === "23503") return new HttpError(404, "not_found", "Not found.");
  if (error.code === "22P02") return new HttpError(404, "not_found", "Not found.");
  console.error("Database error:", error);
  return new HttpError(500, "server_error", "Something went wrong.");
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON.");
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "invalid_body", r.error.issues[0]?.message ?? "Invalid request body.");
  return r.data;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PERSON_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export function requireUuid(id: string): string {
  if (!UUID.test(id)) throw new HttpError(404, "not_found", "Not found.");
  return id;
}

export function requirePersonId(id: string): string {
  if (!PERSON_ID.test(id)) throw new HttpError(404, "not_found", "Not found.");
  return id;
}

/** Wraps a route handler: known errors become clean JSON, unknown ones a 500. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: "server_error", message: "Something went wrong." }, 500);
    }
  };
}
