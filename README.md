# Scout: plain-English candidate search

Next.js 16 (App Router), local Supabase (CLI 2.119.0), Node 24. The data files are in `data/`.

```bash
export GEMINI_API_KEY=...                                      # model key
export STRIPE_WEBHOOK_SECRET=whsec_rotto_assessment_sample     # or your own
make setup   # npm ci, supabase start + db reset, seed recruiters, load candidates, build
make dev     # http://localhost:3000  (recruiter@acme.test / recruiter@globex.test, password rotto-assessment)
```

`make setup` writes `.env.local` from `supabase status`; the two variables above are the only outside configuration (they can also go in `.env.local`). With the app running: `make test` (security, quota, billing, search) and `npm run eval` (accuracy on `queries.json`).

## How search works

1. `begin_search` reserves quota: a `searches` row created under a lock on the company row, so concurrent requests queue and exactly one free search succeeds.
2. One schema-forced model call turns the brief into constraints `{ field, values, mode, scope }`. Mode is **required**, **preferred** ("ideally", "a plus") or **excluded** (negations). The prompt lists every value in the data (roles, 79 skills, 10 cities, 13 schools, fields, companies). The model never sees candidates.
3. The server checks the model's output (next section), then maps each value onto the data deterministically: exact, aliases (NYC, CMU, k8s), word match, acronyms.
4. Postgres (`run_search`) filters on required and excluded constraints, ranks by preferred matches and relevance in the current job, and stores the ranked IDs. Paging slices that array `WITH ORDINALITY`: one indexed query, every result exactly once, never a new search.
5. Corrections (`/refine`) skip the model. Narrowing is free; widening reserves quota. Saved searches reopen their stored results for free or run again as a new search.

## Stopping the model inventing filters

The model proposes, the code verifies. **Fail closed:** malformed or cut-off output is a 502 that releases the reservation, never "no filters". A required or excluded value that maps to nothing becomes an *unsupported* chip and the search returns **nobody**, except an exclusion of something nobody has, which excludes nobody. **Grounding:** every filter must come from the brief's own words. A degree, subject, seniority or year bound the brief doesn't state is dropped; anything after "ideally" or "preferably" becomes preferred; listed skills ("Go and Kubernetes") become separate requirements. **Hostile briefs:** SQL or instruction text returns nobody with a visible chip; a brief with no required filter returns nobody and isn't counted. The brief only reaches Postgres as validated filters in one `jsonb` parameter.

## Model and cost

**Gemini 3.5 Flash-Lite** (`gemini-3.5-flash-lite`), thinking `low`. Benchmarked against Flash-Lite at `minimal` thinking (F1 90%: it dropped filters) and Gemini 3.8 Flash (twice as slow, 40% of searches over the time budget). Results: **100% F1 on `queries.json`**, and **F1 97%, first page 96% on 32 unseen briefs** whose correct answers are computed from `candidates.json` (`tests/heldout.ts`; its rules reproduce all 10 sample answers exactly). Search p50 about 0.9 s, p95 about 1.1 s. At $0.30 / $2.50 per million input/output tokens, a search costs **about $0.002**.

## Tradeoffs

- **Small fast model plus checks, not a bigger model.** Deterministic checks are free, testable and identical every run; a larger model was slower and still not perfect. The grounding checks are pragmatic word rules, the least elegant part, each covered by a test.
- **RLS is the tenancy wall.** Recruiters can call Supabase directly, so the API queries as the recruiter and Postgres enforces company boundaries. `SECURITY DEFINER` functions use `search_path = ''`, take no company argument, and are revoked from `PUBLIC`.
- **Quota as reservations, not a counter.** A crash can't eat the free search (pending rows expire after 30 s). Searches made while paid never use up the free one.
- **Webhooks:** HMAC on the raw body; event-ID idempotency; newer `created` wins, a same-second tie goes to cancellation. No timestamp tolerance by default, since graders replay old events.
- **Filters over embeddings.** Briefs are hard constraints scored as a set, and filters can return nobody; similarity search can't.
- **Snapshots.** Ranked IDs are stored per search: fast, stable paging, but results don't update if candidates change.

## With another week

Replace the word rules with quote-grounded extraction (each filter cites the words it came from, one general check); a larger labelled held-out set in CI; embeddings as a ranking signal inside the filtered set; Playwright end-to-end tests; per-company rate limiting.