import { z } from "zod";
import { requireRecruiter } from "@/server/auth";
import { json, parseBody, requireUuid, route } from "@/server/http";
import { FiltersInput } from "@/server/search/schema";
import { refineSearch } from "@/server/search/service";

const Body = z.object({ filters: FiltersInput });

/** POST /api/search/{id}/refine  { filters } -> edited search. Free if it only narrows. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const rec = await requireRecruiter(req);
  const id = requireUuid((await ctx.params).id);
  const { filters } = await parseBody(req, Body);
  return json(await refineSearch(rec, id, filters));
});
