import { requireRecruiter } from "@/server/auth";
import { fromDb, json, route } from "@/server/http";

/** GET /api/plan -> { plan: "free" | "paid", searches_remaining: number | null } */
export const GET = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const { data, error } = await rec.db.rpc("plan_info");
  if (error) throw fromDb(error);
  return json({ plan: data.plan, searches_remaining: data.searches_remaining });
});
