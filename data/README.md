Put the three provided files here before running `make setup`:

- `candidates.json` (loaded into Postgres by `make setup`)
- `stripe-events.json` (replayed by `npm run test:billing`)
- `queries.json` (scored by `npm run eval`)

Commit them with the repo so `make setup` works on a clean clone.
Run `npm run data:inspect` once to confirm the loader reads every field.
