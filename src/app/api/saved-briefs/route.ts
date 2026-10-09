import { z } from "zod";
import { requireRecruiter } from "@/server/auth";
import { fromDb, HttpError, json, parseBody, route } from "@/server/http";

const Body = z.object({
  brief: z.string().trim().min(1, "A saved search needs its brief.").max(500),
  filters: z.record(z.string(), z.unknown()).default({}),
  /** Optional: the search this was saved from, so its results can be viewed again for free. */
  search_id: z.uuid().optional(),
});

/** GET /api/saved-briefs -> your company's saved searches, newest first. */
export const GET = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const { data, error } = await rec.db
    .from("saved_briefs")
    .select("id, brief, filters, search_id, created_at, searches(total)")
    .order("created_at", { ascending: false });
  if (error) throw fromDb(error);
  return json(data ?? []);
});

/** POST /api/saved-briefs { brief, filters } -> { id }. */
export const POST = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const body = await parseBody(req, Body);
  if (JSON.stringify(body.filters).length > 20_000) throw new HttpError(413, "too_large", "Those filters are too large to save.");
  const { data, error } = await rec.db.from("saved_briefs").insert(body).select("id").single();
  if (error) throw fromDb(error);
  return json({ id: data.id }, 201);
});
