import { requireRecruiter } from "@/server/auth";
import { fromDb, HttpError, json, route } from "@/server/http";

/** GET /api/me -> the recruiter's company, for the header. */
export const GET = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const { data, error } = await rec.db.from("companies").select("id, name").maybeSingle();
  if (error) throw fromDb(error);
  if (!data) throw new HttpError(403, "forbidden", "This account is not linked to a company.");
  return json({ company: data });
});
