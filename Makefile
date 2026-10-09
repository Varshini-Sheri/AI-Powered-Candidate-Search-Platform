SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
SUPABASE := npx --no-install supabase

.PHONY: setup dev preflight db test eval stop

## Install deps, start local Supabase, apply migrations, seed users, load candidates, build the app.
setup: preflight
	npm ci
	@$(SUPABASE) status >/dev/null 2>&1 || $(SUPABASE) start
	$(SUPABASE) db reset --local
	npm run env:write
	npm run seed:users
	npm run data:load
	npm run build
	@echo ""
	@echo "Setup complete. Run: make dev   (then open http://localhost:3000)"

## Serve the production build on http://localhost:3000.
dev:
	@$(SUPABASE) status >/dev/null 2>&1 || $(SUPABASE) start
	@test -d .next || npm run build
	npm run start

preflight:
	@node -e 'const m=+process.versions.node.split(".")[0]; if(m!==24){console.error("Node 24 is required, found "+process.version+". Run: nvm use");process.exit(1)}'
	@docker info >/dev/null 2>&1 || (echo "Docker is not running. Start Docker Desktop and retry." && exit 1)
	@test -f data/candidates.json || (echo "data/candidates.json is missing." && exit 1)

## Run every test suite against a running app (make dev in another terminal).
test:
	npm run test:security
	npm run test:quota
	npm run test:billing
	npm run test:search

eval:
	npm run eval

stop:
	$(SUPABASE) stop
