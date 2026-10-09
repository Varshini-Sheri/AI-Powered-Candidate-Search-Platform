import { requireRecruiter } from "@/server/auth";
import { fromDb, HttpError, json, requireUuid, route } from "@/server/http";
import { FiltersInput } from "@/server/search/schema";
import { newSearch, runWithFilters } from "@/server/search/service";

/**
 * POST /api/saved-briefs/{id}/run -> run a saved search again for today's matches.
 * This is a new search, so on the free plan it uses the free search (402 when it's
 * used). Saved filters are reused; with none, the brief is read again by the model.
 * To look at the results from when it was saved, open its stored search instead,
 * which is free like paging.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const rec = await requireRecruiter(req);
  const id = requireUuid((await ctx.params).id);
  const { data, error } = await rec.db.from("saved_briefs").select("brief, filters").eq("id", id).maybeSingle();
  if (error) throw fromDb(error);
  if (!data) throw new HttpError(404, "not_found", "Saved search not found.");

  const filters = FiltersInput.safeParse(data.filters);
  if (filters.success && filters.data.constraints.length > 0) return json(await runWithFilters(rec, data.brief, filters.data));
  return json(await newSearch(rec, data.brief));
});
