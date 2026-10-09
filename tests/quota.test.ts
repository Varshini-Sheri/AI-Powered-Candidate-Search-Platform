// Free plan: exactly one search, even under concurrency; paging never counts;
// narrowing a search is free and widening it counts.
import { call, check, finish, makePaid, pageAll, resetCompany, section, service, signIn } from "./lib";

const BRIEF = process.env.QUOTA_BRIEF ?? "Senior React engineers in New York";
await resetCompany("acme");
const acme = await signIn("acme");

section("Concurrent searches on a fresh free company");
const plan0 = await call("/api/plan", acme);
check(plan0.body.plan === "free" && plan0.body.searches_remaining === 1, "starts on free with 1 search", plan0.body);
const N = 25;
const results = await Promise.all(Array.from({ length: N }, () => call("/api/search", acme, "POST", { brief: BRIEF })));
const ok = results.filter((r) => r.status === 200);
const blocked = results.filter((r) => r.status === 402);
check(ok.length === 1, `exactly 1 of ${N} simultaneous searches succeeds (got ${ok.length})`, results.map((r) => r.status));
check(blocked.length === N - 1, `the other ${N - 1} get 402`);
const plan1 = await call("/api/plan", acme);
check(plan1.body.searches_remaining === 0, "searches_remaining is 0 afterwards", plan1.body);

if (ok[0]) {
  const s = ok[0].body;
  section("Paging never uses a search");
  const { ids } = await pageAll(acme, s.search_id, s.total);
  check(ids.length === s.total && new Set(ids).size === ids.length, `paging returns all ${s.total} results exactly once`);
  check((await call("/api/plan", acme)).body.searches_remaining === 0, "still 0 after paging (nothing refunded, nothing used)");
  check((await call("/api/search", acme, "POST", { brief: BRIEF })).status === 402, "a new search is 402");

  section("Corrections");
  const req = s.filters.constraints;
  if (req.length >= 2 && s.total > 0) {
    const narrower = { constraints: [...req, { field: "years", mode: "required", min: 1 }], unsupported: s.filters.unsupported };
    const n = await call(`/api/search/${s.search_id}/refine`, acme, "POST", { filters: narrower });
    check(n.status === 200 && n.body.counted === false, "narrowing the filters is free", n.body);
    const wider = { constraints: req.slice(0, 1), unsupported: [] };
    const w = await call(`/api/search/${s.search_id}/refine`, acme, "POST", { filters: wider });
    check(w.status === 402, "widening the filters needs a search (402 on free)", w.status);
  } else {
    console.log("  (skipped: the brief produced fewer than 2 filters or no results)");
  }

  section("Saved searches");
  const saved = await call("/api/saved-briefs", acme, "POST", { brief: BRIEF, filters: s.filters, search_id: s.search_id });
  check(saved.status === 201, "save the free search with its source search", saved.body);
  const list = await call("/api/saved-briefs", acme);
  const linked = list.body.find((x: { id: string }) => x.id === saved.body.id)?.search_id;
  check(linked === s.search_id, "the saved search keeps a link to its results");
  check((await call(`/api/search/${linked}?page=1`, acme)).status === 200, "opening its stored results is free (like paging)");
  check((await call(`/api/saved-briefs/${saved.body.id}/run`, acme, "POST")).status === 402, "running it again is a new search: 402 with the free search used");
  check((await call("/api/plan", acme)).body.searches_remaining === 0, "nothing extra was spent");
  await call(`/api/saved-briefs/${saved.body.id}`, acme, "DELETE");
}

section("A search we couldn't apply doesn't use the free search");
await resetCompany("acme");
const failed = await call("/api/search", acme, "POST", { brief: "software engineers who went to Hogwarts" });
check(failed.status === 200 && failed.body.counted === false, "an unsupported filter returns nobody and isn't counted", failed.body);
check((await call("/api/plan", acme)).body.searches_remaining === 1, "the free search is still there");

section("Searches made while paid don't use up the free search");
await resetCompany("acme");
await makePaid("acme");
const paidSearch = await call("/api/search", acme, "POST", { brief: BRIEF });
check(paidSearch.status === 200, "a search while paid works", paidSearch);
await service.from("subscriptions").delete().eq("company_id", "acme");
const after = (await call("/api/plan", acme)).body;
check(after.plan === "free" && after.searches_remaining === 1, "after the subscription ends, the free search is still there", after);

await resetCompany("acme");
finish();
