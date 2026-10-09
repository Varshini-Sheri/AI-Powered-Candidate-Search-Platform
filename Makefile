SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
SUPABASE := npx --no-install supabase

# If Node 24 is not installed, `make node` downloads it into .tools/node for this
# project only. Putting that folder first on PATH means every recipe uses it.
NODE_DIR := $(CURDIR)/.tools/node
export PATH := $(NODE_DIR)/bin:$(PATH)

.PHONY: setup dev node preflight test eval stop

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
dev: node
	@$(SUPABASE) status >/dev/null 2>&1 || $(SUPABASE) start
	@test -d .next || npm run build
	npm run start

## Use the installed Node if it is version 24, otherwise download Node 24 into .tools/node.
node:
	@if node -v 2>/dev/null | grep -q '^v24\.'; then exit 0; fi; \
	os=$$(uname -s | tr '[:upper:]' '[:lower:]'); \
	case "$$(uname -m)" in \
	  arm64|aarch64) arch=arm64 ;; \
	  x86_64) arch=x64 ;; \
	  *) echo "Unsupported CPU: $$(uname -m). Install Node 24 and retry."; exit 1 ;; \
	esac; \
	tarball=$$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep -m1 -o "node-v24\.[0-9.]*-$$os-$$arch\.tar\.gz" || true); \
	test -n "$$tarball" || { echo "Could not find a Node 24 download for $$os-$$arch. Install Node 24 and retry."; exit 1; }; \
	echo "Node 24 not found. Downloading $$tarball into .tools/ (used by this project only)."; \
	rm -rf "$(NODE_DIR)"; mkdir -p "$(NODE_DIR)"; \
	curl -fsSL "https://nodejs.org/dist/latest-v24.x/$$tarball" | tar -xz -C "$(NODE_DIR)" --strip-components=1; \
	echo "Using Node $$("$(NODE_DIR)/bin/node" -v)"

preflight: node
	@node -e 'const m=+process.versions.node.split(".")[0]; if(m!==24){console.error("Node 24 is required, found "+process.version+".");process.exit(1)}'
	@docker info >/dev/null 2>&1 || (echo "Docker is not running. Start Docker Desktop and retry." && exit 1)
	@test -f data/candidates.json || (echo "data/candidates.json is missing." && exit 1)

## Run every test suite against a running app (make dev in another terminal).
test: node
	npm run test:security
	npm run test:quota
	npm run test:billing
	npm run test:search

eval: node
	npm run eval

stop: node
	$(SUPABASE) stop