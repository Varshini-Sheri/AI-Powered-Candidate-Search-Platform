import { requireRecruiter } from "@/server/auth";
import { fromDb, HttpError, json, requireUuid, route } from "@/server/http";

/** DELETE /api/saved-briefs/{id} */
export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const rec = await requireRecruiter(req);
  const id = requireUuid((await ctx.params).id);
  const { data, error } = await rec.db.from("saved_briefs").delete().eq("id", id).select("id");
  if (error) throw fromDb(error);
  if (!data?.length) throw new HttpError(404, "not_found", "Saved search not found.");
  return json({ ok: true });
});
