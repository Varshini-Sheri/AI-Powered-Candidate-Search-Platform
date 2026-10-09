import { z } from "zod";
import { requireRecruiter } from "@/server/auth";
import { fromDb, HttpError, json, parseBody, requireUuid, route } from "@/server/http";

const Rename = z.object({ name: z.string().trim().min(1, "Give the list a name.").max(80) });
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/shortlists/{id} -> the list with its candidates' cards, newest first. */
export const GET = route(async (req: Request, ctx: Ctx) => {
  const rec = await requireRecruiter(req);
  const id = requireUuid((await ctx.params).id);
  const { data, error } = await rec.db
    .from("shortlists")
    .select("id, name, shortlist_people(added_at, candidates(id, name, headline, avatar_url, location, years_experience, current_title, current_company, current_company_logo, skills))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromDb(error);
  if (!data) throw new HttpError(404, "not_found", "List not found.");
  const rows = (data.shortlist_people ?? []) as unknown as Array<{ added_at: string; candidates: unknown }>;
  const people = rows
    .sort((a, b) => b.added_at.localeCompare(a.added_at))
    .map((p) => p.candidates)
    .filter(Boolean);
  return json({ id: data.id, name: data.name, people });
});

/** PATCH /api/shortlists/{id} { name } -> rename. */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const rec = await requireRecruiter(req);
  const id = requireUuid((await ctx.params).id);
  const { name } = await parseBody(req, Rename);
  const { data, error } = await rec.db.from("shortlists").update({ name }).eq("id", id).select("id");
  if (error) throw fromDb(error);
  if (!data?.length) throw new HttpError(404, "not_found", "List not found.");
  return json({ id, name });
});

/** DELETE /api/shortlists/{id} */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const rec = await requireRecruiter(req);
  const id = requireUuid((await ctx.params).id);
  const { data, error } = await rec.db.from("shortlists").delete().eq("id", id).select("id");
  if (error) throw fromDb(error);
  if (!data?.length) throw new HttpError(404, "not_found", "List not found.");
  return json({ ok: true });
});
