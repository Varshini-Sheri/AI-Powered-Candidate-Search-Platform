// Model benchmark: runs every brief in data/queries.json against two (or more)
// LLM configurations and reports accuracy and latency side by side.
//
// It changes no application code. For each model it starts its own copy of the
// production server (`next start`) on a separate port with LLM_PROVIDER and
// LLM_MODEL set, so the measured path is exactly what a recruiter hits:
// POST /api/search, then paging to the end. Both servers run at once and the
// briefs alternate between them, so network or API slowdowns hit both equally.
//
// Before running:
//   make setup (or `npx next build`) so a production build exists
//   Supabase running, ANTHROPIC_API_KEY and GEMINI_API_KEY exported
//
// Usage:
//   npx tsx tests/bench-models.ts
//   npx tsx tests/bench-models.ts --runs 3 --delay 7000 --out bench.json
//   npx tsx tests/bench-models.ts --models anthropic:claude-haiku-5-5,gemini:gemini-3.6-flash
//   npx tsx tests/bench-models.ts --models "gemini:gemini-3.5-flash-lite,gemini:gemini-3.8-flash+GEMINI_THINKING_LEVEL=low"
//
// Options:
//   --models   comma-separated provider:model list (default: Haiku 5.5 vs Gemini 3.6 Flash).
//              Add +KEY=VALUE after an entry to set an env var for that server only,
//              e.g. +GEMINI_THINKING_LEVEL=low (Gemini 3.7 and 3.8 Flash have no "minimal").
//   --runs     how many times to run each brief per model (default 1; 3+ gives steadier p95)
//   --delay    ms to wait between searches, for rate-limited free tiers (default 0)
//   --port     first port to use; each model gets the next one (default 3101)
//   --no-warmup  skip the one uncounted warm-up search per server
//   --out      also write the raw measurements and summary as JSON to this path
//
// Side effects on the local database, same as `npm run eval`: searches are run
// as the Acme test recruiter, and Acme is put on the paid plan for the run so
// the free-plan limit doesn't block it. If Acme wasn't already paid, the test
// subscription is removed again at the end.

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePaid, service, signIn } from "./lib";

// ---------- arguments ----------

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(`--${name}`);

// Each entry is provider:model, optionally followed by +KEY=VALUE settings for
// that server only, e.g. gemini:gemini-3.8-flash+GEMINI_THINKING_LEVEL=low
interface ModelSpec { id: string; label: string; provider: string; model: string; extraEnv: Record<string, string>; port: number; base: string; logPath?: string }
const logDir = mkdtempSync(join(tmpdir(), "rotto-bench-"));
const firstPort = Number(arg("port", "3101"));
const models: ModelSpec[] = (arg("models", "anthropic:claude-haiku-5-5,gemini:gemini-3.6-flash") as string)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s, i) => {
    const [spec, ...settings] = s.split("+");
    const [provider, ...rest] = spec.split(":");
    const model = rest.join(":");
    if (!provider || !model) throw new Error(`--models entry "${s}" should look like provider:model[+KEY=VALUE]`);
    const extraEnv: Record<string, string> = {};
    for (const kv of settings) {
      const eq = kv.indexOf("=");
      if (eq < 1) throw new Error(`--models setting "${kv}" should look like KEY=VALUE`);
      extraEnv[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    const port = firstPort + i;
    const id = `${provider}:${model}`;
    const extras = Object.entries(extraEnv).map(([k, v]) => `${k === "GEMINI_THINKING_LEVEL" ? "thinking" : k}=${v}`);
    const label = extras.length ? `${id} ${extras.join(" ")}` : id;
    return { id, label, provider, model, extraEnv, port, base: `http://localhost:${port}` };
  });
if (new Set(models.map((m) => m.label)).size !== models.length) throw new Error("--models has the same entry twice");
const runs = Math.max(1, Number(arg("runs", "1")));
const delayMs = Math.max(0, Number(arg("delay", process.env.EVAL_DELAY_MS ?? "0")));
const warmup = !flag("no-warmup");
const outPath = arg("out");
const serverCmd = (process.env.BENCH_SERVER_CMD ?? "npx next start").split(" ");

// ---------- briefs ----------

const queriesPath = "data/queries.json";
if (!existsSync(queriesPath)) {
  console.error(`${queriesPath} not found`);
  process.exit(1);
}
const raw = JSON.parse(readFileSync(queriesPath, "utf8"));
const queries: Array<{ brief: string; expected: Set<string> }> = (Array.isArray(raw) ? raw : raw.queries).map(
  (q: Record<string, unknown>) => ({
    brief: String(q.brief ?? q.query),
    expected: new Set(((q.expected_ids ?? q.expected ?? []) as unknown[]).map(String)),
  }),
);
if (!existsSync(".next/BUILD_ID") && !process.env.BENCH_SERVER_CMD) {
  console.error("No production build found. Run `make setup` or `npx next build` first.");
  process.exit(1);
}

// ---------- servers ----------

const servers: ChildProcess[] = [];

function startServer(m: ModelSpec): ChildProcess {
  const [cmd, ...cmdArgs] = serverCmd;
  const child = spawn(cmd, [...cmdArgs, "-p", String(m.port)], {
    env: { ...process.env, ...m.extraEnv, LLM_PROVIDER: m.provider, LLM_MODEL: m.model, PORT: String(m.port), NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32", // own process group, so stopping it also stops npx's child
  });
  // Full server output goes to a file so 500s can be traced to a stack trace.
  m.logPath = join(logDir, `${m.port}-${m.label.replace(/[^a-z0-9.-]+/gi, "_")}.log`);
  const file = createWriteStream(m.logPath);
  let log = "";
  const onData = (d: Buffer) => {
    file.write(d);
    log = (log + d).slice(-4000);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", (code) => {
    if (!stopping) console.error(`\nServer for ${m.label} exited early (code ${code}). Last output:\n${log}`);
  });
  servers.push(child);
  return child;
}

async function waitReady(m: ModelSpec, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${m.base}/login`);
      if (r.status < 500) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`Server for ${m.label} on port ${m.port} didn't start within ${timeoutMs / 1000}s`);
}

let stopping = false;
function stopServers() {
  stopping = true;
  for (const s of servers) {
    if (s.exitCode !== null || !s.pid) continue;
    try {
      if (process.platform === "win32") s.kill();
      else process.kill(-s.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}
process.on("SIGINT", () => {
  stopServers();
  process.exit(130);
});

// ---------- HTTP ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(base: string, path: string, token: string, method = "GET", body?: unknown) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    // leave as text
  }
  return { status: res.status, body: json, ms };
}

// ---------- one measured search ----------

interface Sample {
  model: string;
  run: number;
  brief: string;
  ok: boolean;
  error?: string;
  llm_ms?: number; // model call only, measured by the server
  search_ms?: number; // POST /api/search round trip: brief in, first page out
  full_ms?: number; // search plus paging through every result
  precision?: number;
  recall?: number;
  f1?: number;
  returned?: number;
  expected: number;
  hits?: number;
  reported_model?: string;
}

async function measure(m: ModelSpec, token: string, q: { brief: string; expected: Set<string> }, run: number): Promise<Sample> {
  const base: Sample = { model: m.label, run, brief: q.brief, ok: false, expected: q.expected.size };
  const t0 = performance.now();
  const s = await call(m.base, "/api/search", token, "POST", { brief: q.brief });
  if (s.status !== 200) return { ...base, error: `HTTP ${s.status} ${JSON.stringify(s.body).slice(0, 160)}` };

  const meta = s.body.meta ?? {};
  const reported = meta.provider && meta.model ? `${meta.provider}:${meta.model}` : undefined;

  // Page to the end, the way grading does.
  const ids: string[] = [];
  const pages = Math.max(1, Math.ceil(Number(s.body.total ?? 0) / 20));
  for (let p = 1; p <= pages; p++) {
    const r = await call(m.base, `/api/search/${s.body.search_id}?page=${p}`, token);
    if (r.status !== 200) return { ...base, error: `page ${p} -> HTTP ${r.status}` };
    ids.push(...(r.body.results ?? []).map((x: { id: string }) => String(x.id)));
  }
  const full = performance.now() - t0;

  const got = new Set(ids);
  const hits = [...got].filter((id) => q.expected.has(id)).length;
  // Same conventions as tests/eval.ts: an empty answer to an empty expectation is perfect.
  const precision = got.size ? hits / got.size : q.expected.size ? 0 : 1;
  const recall = q.expected.size ? hits / q.expected.size : got.size ? 0 : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    ...base,
    ok: true,
    llm_ms: typeof meta.llm_ms === "number" ? meta.llm_ms : undefined,
    search_ms: s.ms,
    full_ms: full,
    precision,
    recall,
    f1,
    returned: got.size,
    hits,
    reported_model: reported,
  };
}

// ---------- stats ----------

function percentile(values: number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length); // nearest-rank method
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);
const nums = (samples: Sample[], key: keyof Sample) =>
  samples.map((s) => s[key]).filter((v): v is number => typeof v === "number");

function summarize(m: ModelSpec, all: Sample[]) {
  const mine = all.filter((s) => s.model === m.label);
  const ok = mine.filter((s) => s.ok);
  const tp = ok.reduce((a, s) => a + (s.hits ?? 0), 0);
  const ret = ok.reduce((a, s) => a + (s.returned ?? 0), 0);
  const exp = ok.reduce((a, s) => a + s.expected, 0);
  const microP = ret ? tp / ret : 0;
  const microR = exp ? tp / exp : 0;
  return {
    model: m.label,
    searches: mine.length,
    failed: mine.length - ok.length,
    // Macro: average of per-brief scores (each brief counts equally, as in eval.ts).
    precision: mean(nums(ok, "precision")),
    recall: mean(nums(ok, "recall")),
    f1: mean(nums(ok, "f1")),
    // Micro: pooled over all results (large result sets weigh more).
    micro_precision: microP,
    micro_recall: microR,
    micro_f1: microP + microR ? (2 * microP * microR) / (microP + microR) : 0,
    llm_p50: percentile(nums(ok, "llm_ms"), 50),
    llm_p95: percentile(nums(ok, "llm_ms"), 95),
    search_p50: percentile(nums(ok, "search_ms"), 50),
    search_p95: percentile(nums(ok, "search_ms"), 95),
    full_p50: percentile(nums(ok, "full_ms"), 50),
    full_p95: percentile(nums(ok, "full_ms"), 95),
  };
}

// ---------- formatting ----------

const pct = (v?: number) => (v === undefined ? "  -  " : `${(v * 100).toFixed(0).padStart(3)}%`);
const msf = (v?: number) => (v === undefined ? "     -" : `${Math.round(v)}`.padStart(6));
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

// ---------- main ----------

const { data: existingSub } = await service.from("subscriptions").select("id").eq("id", "sub_test_acme").maybeSingle();
await makePaid("acme");
const token = await signIn("acme");

const samples: Sample[] = [];
try {
  console.log(`Starting ${models.length} servers: ${models.map((m) => `${m.label} on :${m.port}`).join(", ")}`);
  models.forEach(startServer);
  await Promise.all(models.map((m) => waitReady(m)));

  if (warmup) {
    // First request on a fresh server pays route compilation and connection
    // setup; that's not the model's latency, so it isn't counted.
    for (const m of models) {
      const w = await call(m.base, "/api/search", token, "POST", { brief: queries[0].brief });
      const meta = w.body?.meta ?? {};
      if (w.status !== 200) {
        const hint =
          m.provider === "gemini" && !m.extraEnv.GEMINI_THINKING_LEVEL && !/flash-lite|3\.[56]-flash/.test(m.model)
            ? ` This model may not accept the app's default "minimal" thinking; try ${m.id}+GEMINI_THINKING_LEVEL=low.`
            : " Check the server log for the model's error.";
        throw new Error(`Warm-up search on ${m.label} failed: HTTP ${w.status} ${JSON.stringify(w.body).slice(0, 200)}.${hint}`);
      }
      const reported = meta.provider && meta.model ? `${meta.provider}:${meta.model}` : undefined;
      if (reported && reported !== m.id) {
        throw new Error(`Server for ${m.label} actually used ${reported}. Check that both API keys are set.`);
      }
      if (delayMs) await sleep(delayMs);
    }
  }

  console.log(`Running ${queries.length} briefs x ${runs} run(s) x ${models.length} models\n`);
  for (let run = 1; run <= runs; run++) {
    for (const [i, q] of queries.entries()) {
      // Alternate which model goes first so neither always gets the warmer cache.
      const order = (i + run) % 2 ? [...models].reverse() : models;
      for (const m of order) {
        const s = await measure(m, token, q, run);
        samples.push(s);
        if (!s.ok) console.log(`  ! ${short(m.label, 44)} ${short(q.brief, 50)} ${s.error}`);
        else if (s.reported_model && s.reported_model !== m.id) {
          console.log(`  ! ${m.label} server reported ${s.reported_model}; results for this model are not trustworthy`);
        }
        if (delayMs) await sleep(delayMs);
      }
    }
  }
} finally {
  stopServers();
  if (!existingSub) await service.from("subscriptions").delete().eq("id", "sub_test_acme");
}

// Per-brief table
console.log("\nPer brief (mean over runs)");
console.log(`  ${"brief".padEnd(46)} ${"model".padEnd(44)}    P     R    F1    llm  search`);
for (const q of queries) {
  for (const m of models) {
    const s = samples.filter((x) => x.model === m.label && x.brief === q.brief && x.ok);
    const failed = samples.filter((x) => x.model === m.label && x.brief === q.brief && !x.ok).length;
    console.log(
      `  ${short(q.brief, 46)} ${short(m.label, 44)} ${pct(mean(nums(s, "precision")))} ${pct(mean(nums(s, "recall")))} ${pct(mean(nums(s, "f1")))} ${msf(mean(nums(s, "llm_ms")))} ${msf(mean(nums(s, "search_ms")))}${failed ? `  (${failed} failed)` : ""}`,
    );
  }
}

// Summary table
const summary = models.map((m) => summarize(m, samples));
console.log("\nSummary (latency in ms; P/R/F1 are means over briefs)");
console.log(`  ${"model".padEnd(44)}    P     R    F1  llm p50  llm p95  search p50  search p95  full p50  full p95  failed`);
for (const s of summary) {
  console.log(
    `  ${short(s.model, 44)} ${pct(s.precision)} ${pct(s.recall)} ${pct(s.f1)}    ${msf(s.llm_p50)}    ${msf(s.llm_p95)}       ${msf(s.search_p50)}       ${msf(s.search_p95)}     ${msf(s.full_p50)}     ${msf(s.full_p95)}  ${s.failed}/${s.searches}`,
  );
}

const ranked = summary.filter((s) => s.search_p50 !== undefined).sort((a, b) => a.search_p50! - b.search_p50!);
if (ranked.length > 1) {
  const [fast, slow] = ranked;
  const f1Gap = (fast.f1 ?? 0) - (slow.f1 ?? 0);
  console.log(
    `\nFastest by median search time: ${fast.model} (${Math.round(fast.search_p50!)} ms vs ${Math.round(slow.search_p50!)} ms). ` +
      `F1 ${f1Gap >= 0 ? "+" : ""}${(f1Gap * 100).toFixed(1)} points versus ${slow.model}.`,
  );
}
const okCount = samples.filter((s) => s.ok).length;
const perModel = Math.round(okCount / models.length);
if (perModel < 30) {
  console.log(`About ${perModel} searches per model, so p95 is close to the slowest single search. Raise --runs for a steadier figure.`);
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), runs, delayMs, models: models.map((m) => m.label), summary, samples }, null, 2));
  console.log(`\nWrote ${outPath}`);
}
const failedModels = models.filter((m) => samples.some((s) => s.model === m.label && !s.ok));
if (failedModels.length) {
  console.log("\nServer logs for models with failed searches (look for the stack trace near each error):");
  for (const m of failedModels) console.log(`  ${m.label}: ${m.logPath}`);
}
process.exit(samples.some((s) => !s.ok) ? 1 : 0);