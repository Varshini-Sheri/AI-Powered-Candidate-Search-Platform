import { z } from "zod";
import { requireRecruiter } from "@/server/auth";
import { fromDb, json, parseBody, route } from "@/server/http";
import { newSearch } from "@/server/search/service";

const Body = z.object({ brief: z.string().trim().min(3, "Describe who you're looking for.").max(500, "Keep the brief under 500 characters.") });

/** GET /api/search -> your company's 10 most recent searches, newest first (the Search tab reopens the latest). */
export const GET = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const { data, error } = await rec.db
    .from("searches")
    .select("id, brief, total, created_at")
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw fromDb(error);
  return json(data ?? []);
});

/** POST /api/search  { brief } -> { search_id, filters, total, results, searches_remaining } */
export const POST = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const { brief } = await parseBody(req, Body);
  return json(await newSearch(rec, brief));
});
