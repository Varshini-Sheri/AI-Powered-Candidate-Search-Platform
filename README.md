# Scout: Plain-English Candidate Search

Scout turns plain-English recruiting briefs into structured searches over 5,000 candidates, with editable filters, shortlists and saved searches. Built with **Next.js 16, TypeScript, Node 24 and local Supabase (CLI 2.119.0)**. Acme and Globex share candidate data; their searches and shortlists are isolated.

## Getting started

```bash
export GEMINI_API_KEY=...
export STRIPE_WEBHOOK_SECRET=whsec_rotto_assessment_sample
make setup
make dev
```

`make setup` installs dependencies, starts Supabase, applies migrations, seeds recruiters, imports `data/candidates.json`, builds the app and writes the Supabase keys to `.env.local`. The two keys above can go in your shell or in `.env.local`, before or after setup (setup keeps existing lines).

Open **http://localhost:3000** and sign in as `recruiter@acme.test` or `recruiter@globex.test` (password `rotto-assessment`). `make test` runs the security, quota, billing and search tests; `npm run eval` scores `data/queries.json`.

## How search works

1. **Reserve quota.** `begin_search` locks the company row and creates a pending search, so concurrent requests can't share the free search.
2. **Read the brief.** One schema-constrained Gemini call returns constraints as `{ field, values, mode, scope }`, where mode is required, preferred or excluded. The model sees the searchable vocabulary (read from the database at runtime), never candidate records.
3. **Check and resolve.** Server code checks each constraint against the brief's wording, then maps values through exact names, aliases, word matches and acronyms.
4. **Filter and rank.** `run_search` applies required and excluded constraints, ranks by preferences and current-job relevance, and stores the ordered IDs.
5. **Page.** Pages slice the stored IDs (`WITH ORDINALITY`): stable, no duplicates, no extra quota.

Editing or removing a filter re-runs Postgres without another model call. Saved searches reopen stored results or run fresh.

## Keeping the model honest

The model only extracts constraints; it never writes SQL, picks candidates or ranks. A constraint must be supported by the brief: unstated seniority, degrees and year limits are dropped, "ideally" makes a preference, and "Go and Kubernetes" becomes two required skills. A required term outside the data becomes an "unsupported" chip and returns nobody rather than widening the search; an unknown exclusion excludes nobody. Malformed model output returns 502 and releases the reservation. Injection attempts return no candidates, and Postgres receives only validated filters as one parameterized `jsonb` argument.

## Model, accuracy, cost

**Gemini 3.5 Flash-Lite, low thinking.** With minimal thinking it dropped constraints (90% F1); Gemini 3.8 Flash was about twice as slow, with 40% of searches over the latency budget.

| Measurement | Result |
|---|---|
| 10 provided briefs | 100% F1 |
| 32 held-out briefs (used while tuning) | 97% F1, 96% first page |
| 24 fresh briefs (written after tuning) | 94% F1, 94% first page |
| Search latency | ~0.9 s p50 / ~1.1 s p95 |
| Model cost | ~$0.002 per search ($0.30 / $2.50 per M tokens) |

Held-out answers are computed from `candidates.json` by rules that reproduce all ten provided answer sets (`tests/heldout.ts`, `tests/heldout-fresh.ts`). The fresh set is the honest number.

## Security, quota, billing

**Isolation:** Row Level Security on searches, shortlists and saved searches, including direct Supabase access. `SECURITY DEFINER` functions use an empty `search_path`, take no company ID and are revoked from `PUBLIC`. Secret keys stay server-side.

**Free plan:** one lifetime search per company via atomic reservations; pending ones expire after 30 s. Empty or unsupported searches and searches made while paid don't count.

**Stripe webhooks:** raw-body HMAC check; event IDs make retries no-ops. Per subscription, only a newer event applies, and a cancellation wins a same-second tie. A canceled subscription is final, as in Stripe (resubscribing creates a new ID). A company is paid while any subscription is `active`. No timestamp tolerance, so replayed sample events are accepted. No Stripe API calls.

## Tradeoffs

- **One schema-forced call, not an agent or a bigger model.** A single translation step under a 3 s budget doesn't need tool loops, and 3.8 Flash was slower without being more reliable. Cost: a small model invents filters, so I check them with word rules, which are heuristics and the least elegant part.
- **Fail closed.** An unsupported requirement returns nobody instead of a broader list. Cost: some searches come back empty, which is why every filter is editable.
- **Filters over embeddings.** Exact requirements need exact matches and real exclusions, and "nobody fits" must be a possible answer. Cost: no fuzzy "similar to" matching.
- **Quota as reservations, not a counter.** Concurrent requests can't overspend and a crash can't burn the free search. Cost: a 30 s expiry and rules for what counts.
- **Canceled is final; only `active` is paid.** Matches Stripe, where resubscribing creates a new ID, and keeps late events from reviving a subscription. Cost: `trialing` and `past_due` count as free.
- **Result snapshots.** Fast, stable paging. Cost: results don't reflect later candidate edits.


