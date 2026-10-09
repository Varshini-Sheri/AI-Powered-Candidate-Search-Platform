// Tenancy and key isolation: signed in as Acme, try to read and change Globex's
// shortlists and saved searches through our API and directly through Supabase.
import { createClient } from "@supabase/supabase-js";
import { BASE, call, check, finish, section, service, signIn } from "./lib";

const acme = await signIn("acme");
const globex = await signIn("globex");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const asAcme = createClient(url, key, { global: { headers: { Authorization: `Bearer ${acme}` } }, auth: { persistSession: false } });
const asAnon = createClient(url, key, { auth: { persistSession: false } });

const { data: someone } = await service.from("candidates").select("id").limit(2);
const [p1, p2] = (someone ?? []).map((r) => r.id);

// Globex creates data through the API.
const gList = (await call("/api/shortlists", globex, "POST", { name: `Globex secret ${Date.now()}` })).body.id;
await call(`/api/shortlists/${gList}/people/${p1}`, globex, "POST");
const gSaved = (await call("/api/saved-briefs", globex, "POST", { brief: "globex private brief", filters: {} })).body.id;
const { data: gSearch } = await service.from("searches").insert({ company_id: "globex", brief: "globex search", status: "done", result_ids: [p1], total: 1 }).select("id").single();
const snapshot = async () => JSON.stringify([
  (await service.from("shortlists").select("id,name,company_id").eq("id", gList)).data,
  (await service.from("shortlist_people").select("person_id").eq("shortlist_id", gList)).data,
  (await service.from("saved_briefs").select("id,brief,company_id").eq("id", gSaved)).data,
]);
const before = await snapshot();

section("Through our API, as Acme");
const lists = await call("/api/shortlists", acme);
check(lists.status === 200 && !lists.body.some((l: { id: string }) => l.id === gList), "list shortlists hides Globex's");
check((await call(`/api/shortlists/${gList}`, acme)).status === 404, "read Globex list -> 404");
check((await call(`/api/shortlists/${gList}`, acme, "PATCH", { name: "hacked" })).status === 404, "rename Globex list -> 404");
check((await call(`/api/shortlists/${gList}`, acme, "DELETE")).status === 404, "delete Globex list -> 404");
check((await call(`/api/shortlists/${gList}/people/${p2}`, acme, "POST")).status === 404, "add to Globex list -> 404");
check((await call(`/api/shortlists/${gList}/people/${p1}`, acme, "DELETE")).status === 404, "remove from Globex list -> 404");
const saved = await call("/api/saved-briefs", acme);
check(saved.status === 200 && !saved.body.some((s: { id: string }) => s.id === gSaved), "list saved searches hides Globex's");
check((await call(`/api/saved-briefs/${gSaved}`, acme, "DELETE")).status === 404, "delete Globex saved search -> 404");
check((await call(`/api/saved-briefs/${gSaved}/run`, acme, "POST")).status === 404, "run Globex saved search -> 404");
check((await call("/api/saved-briefs", acme, "POST", { brief: "borrow", filters: {}, search_id: gSearch!.id })).status === 404, "save a search linked to Globex's search -> refused");
const recentA = await call("/api/search", acme);
check(recentA.status === 200 && !recentA.body.some((x: { id: string }) => x.id === gSearch!.id), "recent searches hides Globex's");
check((await call(`/api/search/${gSearch!.id}?page=1`, acme)).status === 404, "page Globex search -> 404");
check((await call(`/api/search/${gSearch!.id}/refine`, acme, "POST", { filters: { constraints: [{ field: "skill", mode: "required", values: ["react"] }] } })).status === 404, "refine Globex search -> 404");

section("Directly through Supabase, with Acme's token");
const sl = await asAcme.from("shortlists").select("id, company_id");
check(!sl.error && (sl.data ?? []).every((r) => r.company_id === "acme"), "select shortlists returns only Acme's", sl.error);
const ins = await asAcme.from("shortlists").insert({ name: "sneaky", company_id: "globex" });
check(!!ins.error, "insert a shortlist stamped globex is refused");
await asAcme.from("shortlists").update({ name: "hacked" }).eq("id", gList);
await asAcme.from("shortlists").delete().eq("id", gList);
const sp = await asAcme.from("shortlist_people").insert({ shortlist_id: gList, person_id: p2 });
check(!!sp.error, "add a person to Globex's list is refused");
await asAcme.from("shortlist_people").delete().eq("shortlist_id", gList);
const sb = await asAcme.from("saved_briefs").select("id, company_id");
check(!sb.error && (sb.data ?? []).every((r) => r.company_id === "acme"), "select saved_briefs returns only Acme's");
const sbIns = await asAcme.from("saved_briefs").insert({ brief: "x", company_id: "globex" });
check(!!sbIns.error, "insert a saved search stamped globex is refused");
await asAcme.from("saved_briefs").update({ brief: "hacked" }).eq("id", gSaved);
await asAcme.from("saved_briefs").delete().eq("id", gSaved);
const srch = await asAcme.from("searches").select("id, company_id");
check(!srch.error && (srch.data ?? []).every((r) => r.company_id === "acme"), "select searches returns only Acme's");
check(!!(await asAcme.from("searches").insert({ company_id: "acme", brief: "free search", status: "done" })).error, "insert a search row directly is refused");
check(!!(await asAcme.rpc("search_page", { p_search_id: gSearch!.id, p_page: 1 })).error, "rpc search_page on Globex search is refused");
check(!!(await asAcme.rpc("refine_search", { p_parent_id: gSearch!.id, p_filters: {}, p_weights: {} })).error, "rpc refine_search on Globex search is refused");
const subs = await asAcme.from("subscriptions").select("*");
check(!!subs.error || (subs.data ?? []).length === 0, "billing tables are not readable");
check(!!(await asAcme.from("subscriptions").insert({ id: "sub_fake", company_id: "acme", status: "active", last_event_created: 9e9, last_event_id: "x" })).error, "cannot grant itself a subscription");
check(!!(await asAcme.rpc("apply_stripe_event", { p_event: { id: "evt_x", type: "customer.subscription.created" } })).error, "cannot call the billing function");
await asAcme.from("companies").update({ name: "x" }).eq("id", "acme");
check((await service.from("companies").select("name").eq("id", "acme").single()).data?.name === "Acme", "company rows are read-only");
const comp = await asAcme.from("companies").select("id");
check(!comp.error && comp.data?.length === 1 && comp.data[0].id === "acme", "sees only its own company");
const rec = await asAcme.from("recruiters").select("company_id");
check(!rec.error && rec.data?.length === 1, "sees only its own recruiter row");

section("Without a token");
check(!!(await asAnon.from("candidates").select("id").limit(1)).error, "anon cannot read candidates");
check(!!(await asAnon.rpc("plan_info")).error, "anon cannot call functions");
check((await call("/api/shortlists", null)).status === 401, "API without a token -> 401");
check((await call("/api/plan", "not-a-real-token")).status === 401, "API with a forged token -> 401");

section("Globex data is untouched");
check((await snapshot()) === before, "Globex's list, members and saved search are unchanged");

section("No secrets in the browser");
const html = await (await fetch(`${BASE}/login`)).text();
const secret = process.env.SUPABASE_SECRET_KEY!;
check(!html.includes(secret), "login page HTML has no secret key");
const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
let leaked = false;
for (const s of scripts) {
  const js = await (await fetch(`${BASE}${s}`)).text();
  const modelKeys = [process.env.ANTHROPIC_API_KEY, process.env.GEMINI_API_KEY].filter((k): k is string => !!k);
  if (js.includes(secret) || modelKeys.some((k) => js.includes(k))) leaked = true;
}
check(!leaked && scripts.length > 0, `none of ${scripts.length} page scripts contains a secret`);

await service.from("shortlists").delete().eq("id", gList);
await service.from("saved_briefs").delete().eq("id", gSaved);
await service.from("searches").delete().eq("id", gSearch!.id);
finish();
