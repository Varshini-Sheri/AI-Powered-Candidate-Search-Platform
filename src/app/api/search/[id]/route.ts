import { requireRecruiter } from "@/server/auth";
import { HttpError, json, requireUuid, route } from "@/server/http";
import { searchPage } from "@/server/search/service";

/** GET /api/search/{id}?page=N  -> 20 results per page, never counts as a search. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const rec = await requireRecruiter(req);
  const id = requireUuid((await ctx.params).id);
  const raw = new URL(req.url).searchParams.get("page") ?? "1";
  if (!/^\d{1,6}$/.test(raw) || Number(raw) < 1) throw new HttpError(400, "invalid_page", "page must be a positive integer.");
  return json(await searchPage(rec, id, Number(raw)));
});
