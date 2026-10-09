import { requireRecruiter } from "@/server/auth";
import { fromDb, HttpError, json, requirePersonId, route } from "@/server/http";

/** GET /api/people/{id} -> one candidate, plus which of your shortlists hold them. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const rec = await requireRecruiter(req);
  const id = requirePersonId((await ctx.params).id);
  const [person, lists] = await Promise.all([
    rec.db.from("candidates").select("profile").eq("id", id).maybeSingle(),
    rec.db.from("shortlist_people").select("shortlist_id").eq("person_id", id),
  ]);
  if (person.error) throw fromDb(person.error);
  if (!person.data) throw new HttpError(404, "not_found", "Candidate not found.");
  return json({ ...person.data.profile, shortlist_ids: (lists.data ?? []).map((r) => r.shortlist_id) });
});
