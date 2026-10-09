import { z } from "zod";
import { requireRecruiter } from "@/server/auth";
import { fromDb, json, parseBody, route } from "@/server/http";

const Body = z.object({ name: z.string().trim().min(1, "Give the list a name.").max(80) });

/** GET /api/shortlists -> your company's lists (RLS hides the other company's). */
export const GET = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const { data, error } = await rec.db
    .from("shortlists")
    .select("id, name, created_at, shortlist_people(person_id)")
    .order("created_at", { ascending: true });
  if (error) throw fromDb(error);
  return json(
    (data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      created_at: l.created_at,
      person_ids: (l.shortlist_people ?? []).map((p: { person_id: string }) => p.person_id),
      count: (l.shortlist_people ?? []).length,
    })),
  );
});

/** POST /api/shortlists { name } -> { id }. company_id is set by the database. */
export const POST = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const { name } = await parseBody(req, Body);
  const { data, error } = await rec.db.from("shortlists").insert({ name }).select("id").single();
  if (error) throw fromDb(error);
  return json({ id: data.id }, 201);
});
