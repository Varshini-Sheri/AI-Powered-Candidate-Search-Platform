import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRecruiter } from "@/server/auth";
import { fromDb, HttpError, json, requirePersonId, requireUuid, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string; personId: string }> };

/** RLS only shows the caller's own lists, so another company's id reads as missing. */
async function requireOwnList(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("shortlists").select("id").eq("id", id).maybeSingle();
  if (error) throw fromDb(error);
  if (!data) throw new HttpError(404, "not_found", "List not found.");
}

/** POST: add a candidate. Adding someone already on the list changes nothing. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const rec = await requireRecruiter(req);
  const p = await ctx.params;
  const id = requireUuid(p.id);
  const personId = requirePersonId(p.personId);
  await requireOwnList(rec.db, id);
  const { error } = await rec.db
    .from("shortlist_people")
    .upsert({ shortlist_id: id, person_id: personId }, { onConflict: "shortlist_id,person_id", ignoreDuplicates: true });
  if (error) throw fromDb(error);
  return json({ ok: true });
});

/** DELETE: remove a candidate. */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const rec = await requireRecruiter(req);
  const p = await ctx.params;
  const id = requireUuid(p.id);
  const personId = requirePersonId(p.personId);
  await requireOwnList(rec.db, id);
  const { error } = await rec.db.from("shortlist_people").delete().eq("shortlist_id", id).eq("person_id", personId);
  if (error) throw fromDb(error);
  return json({ ok: true });
});
