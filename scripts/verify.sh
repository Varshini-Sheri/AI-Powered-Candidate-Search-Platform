#!/usr/bin/env bash
# Pre-submission check against the grading criteria. Changes nothing in the repo.
#
# Usage:
#   1. Terminal 1, start the app the way graders will (your shell overrides removed):
#        env -u LLM_MODEL -u GEMINI_THINKING_LEVEL -u LLM_DEBUG make dev
#   2. Terminal 2:
#        bash scripts/verify.sh            # everything (~5 min, a few cents of Gemini)
#        bash scripts/verify.sh quick      # skips generalize and the speed benchmark
#
# Full output of every step goes to /tmp/rotto-verify.log; the screen shows only the summary.

set -u
cd "$(dirname "$0")/.."
LOG=/tmp/rotto-verify.log   # outside the repo, so it never shows as an uncommitted file
: > "$LOG"
QUICK=${1:-}
declare -a ROWS=()
FAILS=0

row() { # status area detail
  ROWS+=("$(printf '%-5s %-16s %s' "$1" "$2" "$3")")
  [ "$1" = FAIL ] && FAILS=$((FAILS + 1))
  printf '%-5s %-16s %s\n' "$1" "$2" "$3"
}
step() { printf '\n===== %s =====\n' "$1" >> "$LOG"; echo "... $1"; }

# 1. Repo hygiene -----------------------------------------------------------------------
step "repo hygiene"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  row FAIL "Repo" "not a git repository: graders clone your GitHub repo, so init, commit and push"
fi
missing=""
for f in package-lock.json Makefile README.md .nvmrc supabase/config.toml data/candidates.json; do
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 || missing="$missing $f"
done
leaked=$(git ls-files 2>/dev/null | grep -E '(^|/)\.env(\.local)?$|^&1$|\.log$' | tr '\n' ' ')
{ echo "missing:$missing"; echo "tracked but shouldn't be: $leaked"; git status --short 2>&1; } >> "$LOG"
if [ -n "$missing$leaked" ]; then row FAIL "Repo" "untracked:${missing:- none}  should not be tracked: ${leaked:-none}"
else row PASS "Repo" "lockfile, Makefile, README, .nvmrc tracked; no env files or logs tracked"; fi
[ -n "$(git status --short 2>/dev/null)" ] && row CHECK "Repo" "uncommitted changes: commit before submitting (git status)"

# 2. Code defaults = the tested model ------------------------------------------------
step "model defaults"
grep -rn 'gemini-3\.[0-9]-flash[a-z-]*' src/server/env.ts >> "$LOG" 2>&1
grep -n 'GEMINI_THINKING_LEVEL ||' src/server/search/llm.ts >> "$LOG" 2>&1
if grep -q 'gemini-3\.5-flash-lite' src/server/env.ts && grep -q 'GEMINI_THINKING_LEVEL || "low"' src/server/search/llm.ts; then
  row PASS "Model default" "gemini-3.5-flash-lite, low thinking in code"
else
  row FAIL "Model default" "set default model to gemini-3.5-flash-lite (env.ts) and thinking to \"low\" (llm.ts)"
fi

# 3. Types ------------------------------------------------------------------------------
step "typecheck"
if npx tsc --noEmit >> "$LOG" 2>&1; then row PASS "Typecheck" "tsc clean"
else row FAIL "Typecheck" "$(grep -m1 'error TS' "$LOG")"; fi

# 4. App running ------------------------------------------------------------------------
step "app"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/login)
if [ "$code" != 200 ]; then
  row FAIL "App" "localhost:3000/login -> $code. Start it in another terminal (see top of this file)"
  echo; echo "Stopped: the remaining checks need the app running."; exit 1
fi
row PASS "App" "running on :3000"

# 5. Test suites: security, hostile briefs, quota, billing, paging ------------------------
for t in security search quota billing; do
  f=tests/$t.test.ts
  [ -f "$f" ] || { row CHECK "Suite $t" "$f not found"; continue; }
  step "suite $t"
  out=$(npx tsx "$f" 2>&1); echo "$out" >> "$LOG"
  summary=$(echo "$out" | grep -E '[0-9]+ passed, [0-9]+ failed' | tail -1)
  firstfail=$(echo "$out" | grep -m1 'FAIL' | sed 's/^ *//' | cut -c1-90)
  if echo "$summary" | grep -q ' 0 failed'; then row PASS "Suite $t" "$summary"
  else row FAIL "Suite $t" "${summary:-crashed} ${firstfail:+| $firstfail}"; fi
done

# 6. Accuracy on the sample briefs, 3 runs (catches flaky briefs) -----------------------
step "eval x3"
model=""; means=""; worst=""
for i in 1 2 3; do
  out=$(npm run --silent eval 2>&1); echo "$out" >> "$LOG"
  model=$(echo "$out" | grep -m1 '^Model:' | sed 's/^Model: //')
  means="$means $(echo "$out" | grep '^mean' | grep -oE 'F1 +[0-9]+%' | grep -oE '[0-9]+%')"
  w=$(echo "$out" | grep -E '^P |^!' | grep -v 'F1 100%' | cut -c1-110 | head -2)
  [ -n "$w" ] && worst="$worst"$'\n'"      run $i: $w"
done
case "$model" in *3.5-flash-lite*) ;; *) row FAIL "Eval model" "app is running '$model', not gemini-3.5-flash-lite (restart it without overrides)";; esac
if [ -z "$(echo "$means" | xargs)" ]; then row FAIL "Accuracy" "eval produced no score (see $LOG)"
elif [ "$(echo "$means" | tr ' ' '\n' | grep -v '^$' | grep -cv '^100%$')" = 0 ]; then row PASS "Accuracy" "F1 per run:$means"
else row CHECK "Accuracy" "F1 per run:$means (some runs under 100%)$worst"; fi

if [ "$QUICK" != quick ]; then
  # 7. Generalization: unseen briefs, synonyms, subsets, unanswerable ------------------
  if [ -f tests/generalize.ts ]; then
    step "generalize"
    out=$(npx tsx tests/generalize.ts --runs 2 2>&1); echo "$out" >> "$LOG"
    summary=$(echo "$out" | grep -E '[0-9]+ passed, [0-9]+ failed' | tail -1)
    [ -z "$summary" ] && summary="crashed: $(echo "$out" | grep -m1 -E 'Error|error' | cut -c1-120)"
    fails=$(echo "$out" | grep -E '^(FAIL|  UNSTABLE)' | sed 's/^ *//' | cut -c1-100 | head -4 | sed 's/^/      /')
    if echo "$summary" | grep -qE ' 0 failed.* 0 unstable'; then row PASS "Generalize" "$summary"
    else row CHECK "Generalize" "$summary"$'\n'"$fails"; fi
  fi

  # 8. Speed: production build, search p95 < 3 s ------------------------------------
  if [ -f tests/bench-models.ts ] && [ -f .next/BUILD_ID ]; then
    step "speed"
    out=$(npx tsx tests/bench-models.ts --runs 2 --models "gemini:gemini-3.5-flash-lite+GEMINI_THINKING_LEVEL=low" 2>&1); echo "$out" >> "$LOG"
    line=$(echo "$out" | grep -E '^  gemini:' | tail -1)
    p95=$(echo "$line" | awk '{print $(NF-3)}')   # columns end: search p95, full p50, full p95, failed
    failed=$(echo "$line" | awk '{print $NF}')
    if [ -n "$p95" ] && [ "$p95" -lt 3000 ] 2>/dev/null; then row PASS "Speed" "search p95 ${p95} ms, failed $failed"
    else row FAIL "Speed" "search p95 ${p95:-?} ms (limit 3000), failed ${failed:-?}"; fi
  else
    row CHECK "Speed" "skipped: needs tests/bench-models.ts and a build (npx next build)"
  fi
fi

# Build freshness: the speed benchmark and the secrets scan both read the production build.
if [ -f .next/BUILD_ID ] && [ -n "$(find src -newer .next/BUILD_ID -type f | head -1)" ]; then
  row CHECK "Build" "source changed since the last build: run 'npx next build' and rerun for accurate Speed/Secrets"
fi

# 9. Secrets never reach the browser ---------------------------------------------------
step "secrets"
hits=$(grep -rlE 'sb_secret_[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|sk-ant-[A-Za-z0-9_-]{16,}|whsec_[A-Za-z0-9_]{8,}' .next/static 2>/dev/null | head -3)
for k in "${GEMINI_API_KEY:-}" "${SUPABASE_SECRET_KEY:-}"; do
  [ -n "$k" ] && hits="$hits $(grep -rlF "$k" .next/static 2>/dev/null | head -1)"
done
[ -f scripts/check-secrets.ts ] && { npx tsx scripts/check-secrets.ts >> "$LOG" 2>&1 || hits="$hits check-secrets.ts failed"; }
hits=$(echo "$hits" | xargs)
if [ -n "$hits" ]; then row FAIL "Secrets" "found in browser bundle: $hits"
else row PASS "Secrets" "no keys in .next/static"; fi

# 10. Server log: anything that went wrong during the run --------------------------------
if [ -f /tmp/dev.log ]; then
  n=$(grep -cE 'LLM call failed|Unusable|TypeError|Unhandled' /tmp/dev.log)
  [ "$n" -gt 0 ] && row CHECK "Server log" "$n errors/warnings in /tmp/dev.log (grep -E 'LLM call failed|Unusable' /tmp/dev.log)"
fi

# 11. README (one page; graders read it for 5 points of judgement) ------------------------
step "readme"
words=$(wc -w < README.md)
need=""
grep -qi 'flash-lite' README.md || need="$need model-name"
grep -qiE 'cost|\$0\.' README.md || need="$need cost-per-search"
grep -qiE 'unsupported|invent' README.md || need="$need invented-filters"
grep -qiE 'trade-?off' README.md || need="$need tradeoffs"
grep -qiE 'another week|next week|with more time' README.md || need="$need another-week"
grep -qiE '3\.6-flash|minimal' README.md && need="$need stale-model-text"
if [ -n "$need" ]; then row FAIL "README" "$words words; missing/stale:$need"
elif [ "$words" -gt 700 ]; then row CHECK "README" "$words words: one page is roughly 500-700"
else row PASS "README" "$words words, all required sections"; fi

# Summary ----------------------------------------------------------------------------------
echo
echo "=================== SUMMARY ==================="
printf '%s\n' "${ROWS[@]}"
echo "==============================================="
echo "$FAILS failing. Full output: $LOG"
echo "Not covered here: UI on desktop + phone (20 pts) and a clean-clone setup. Do those by hand."
exit $(( FAILS > 0 ))