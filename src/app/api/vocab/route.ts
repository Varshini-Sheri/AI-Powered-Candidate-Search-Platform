import { requireRecruiter } from "@/server/auth";
import { HttpError, json, route } from "@/server/http";
import { EDUCATION_LABELS, ROLE_LABELS, SENIORITY_LABELS, compactKey, simpleKey } from "@/lib/normalize";
import { loadVocab, type Kind } from "@/server/search/vocab";

const KINDS: Record<string, Kind | "role" | "seniority" | "education_level"> = {
  skill: "skill", title: "title", location: "location", company: "company", company_trait: "trait",
  school: "school", field_of_study: "field_of_study", role: "role", seniority: "seniority", education_level: "education_level",
};

/** GET /api/vocab?field=skill&q=rea -> suggestions for the filter editor. */
export const GET = route(async (req: Request) => {
  const rec = await requireRecruiter(req);
  const url = new URL(req.url);
  const kind = KINDS[url.searchParams.get("field") ?? ""];
  if (!kind) throw new HttpError(400, "invalid_field", "Unknown field.");
  const q = (url.searchParams.get("q") ?? "").slice(0, 60);

  const fixed = kind === "role" ? ROLE_LABELS : kind === "seniority" ? SENIORITY_LABELS : kind === "education_level" ? EDUCATION_LABELS : null;
  if (fixed) return json(Object.entries(fixed).map(([key, label]) => ({ key, label })));

  const vocab = await loadVocab(rec.db);
  const qs = simpleKey(q);
  const qc = compactKey(q);
  const items = [...vocab[kind as Kind].values()]
    .filter((e) => !q || simpleKey(e.label).includes(qs) || compactKey(e.label).includes(qc))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((e) => ({ key: e.key, label: e.label }));
  return json(items);
});
