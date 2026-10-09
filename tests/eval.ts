// Accuracy on data/queries.json, measured the way grading does: run each brief,
// page to the end, and score against the expected set. Also reports latency,
// tokens and cost per search. Makes real LLM calls (costs a little).
// Usage: npm run eval            (all briefs)
//        npm run eval -- --holdout 3   (report the last 3 separately; don't tune on them)
import { existsSync, readFileSync } from "node:fs";
import { call, makePaid, pageAll, resetCompany, signIn } from "./lib";

// USD per million tokens. Defaults are Claude Haiku 5.5 list prices (prompts under
// 100k tokens). For another model set EVAL_PRICE_INPUT, EVAL_PRICE_OUTPUT and
// EVAL_PRICE_CACHE_READ to its current list prices.
const price = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);
const PRICE = {
  input: price("EVAL_PRICE_INPUT", 0.1),
  output: price("EVAL_PRICE_OUTPUT", 0.5),
  cacheRead: price("EVAL_PRICE_CACHE_READ", 0.01),
};
let modelSeen = "";

const path = "data/queries.json";
if (!existsSync(path)) {
  console.error("data/queries.json not found");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(path, "utf8"));
const queries: Array<{ brief: string; expected: Set<string> }> = (Array.isArray(raw) ? raw : raw.queries).map((q: Record<string, unknown>) => ({
  brief: String(q.brief ?? q.query),
  expected: new Set(((q.expected_ids ?? q.expected ?? []) as unknown[]).map(String)),
}));
const holdoutArg = process.argv.indexOf("--holdout");
const holdout = holdoutArg > -1 ? Number(process.argv[holdoutArg + 1]) : 0;

await resetCompany("acme");
await makePaid("acme");
const token = await signIn("acme");

interface Row { brief: string; p: number; r: number; f1: number; first: number; n: number; exp: number; ms: number; cost: number; filters: string }
const rows: Row[] = [];
for (const q of queries) {
  const s = await call("/api/search", token, "POST", { brief: q.brief });
  if (s.status !== 200) {
    console.log(`! ${q.brief}: HTTP ${s.status} ${JSON.stringify(s.body)}`);
    continue;
  }
  const { ids } = await pageAll(token, s.body.search_id, s.body.total);
  const got = new Set(ids);
  const hit = [...got].filter((id) => q.expected.has(id)).length;
  const p = got.size ? hit / got.size : q.expected.size ? 0 : 1;
  const r = q.expected.size ? hit / q.expected.size : got.size ? 0 : 1;
  const firstIds = ids.slice(0, 20);
  const firstDen = Math.min(20, q.expected.size);
  const first = firstDen ? firstIds.filter((id) => q.expected.has(id)).length / firstDen : firstIds.length ? 0 : 1;
  const m = s.body.meta ?? {};
  modelSeen ||= `${m.provider ?? "?"} / ${m.model ?? "?"}`;
  const uncached = Math.max(0, (m.input_tokens ?? 0));
  const cost = (uncached * PRICE.input + (m.cache_read_tokens ?? 0) * PRICE.cacheRead + (m.output_tokens ?? 0) * PRICE.output) / 1e6;
  const filters = [
    ...s.body.filters.constraints.map((c: any) => `${c.mode === "required" ? "" : c.mode === "preferred" ? "~" : "!"}${c.field}=${c.field === "years" ? `${c.min ?? ""}..${c.max ?? ""}` : c.values.join("|")}`),
    ...s.body.filters.unsupported.map((u: any) => `?${u.mode}:${u.text}`),
  ].join(" ");
  rows.push({ brief: q.brief, p, r, f1: p + r ? (2 * p * r) / (p + r) : 0, first, n: got.size, exp: q.expected.size, ms: s.ms, cost, filters });
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
function report(title: string, list: Row[]) {
  if (!list.length) return;
  console.log(`\n${title}`);
  for (const x of list) {
    console.log(`P ${pct(x.p)}  R ${pct(x.r)}  F1 ${pct(x.f1)}  first ${pct(x.first)}  ${String(x.n).padStart(4)}/${String(x.exp).padEnd(4)} ${Math.round(x.ms)}ms  ${x.brief}`);
    console.log(`        ${x.filters}`);
  }
  const avg = (k: keyof Row) => list.reduce((s, x) => s + (x[k] as number), 0) / list.length;
  console.log(`mean: P ${pct(avg("p"))}  R ${pct(avg("r"))}  F1 ${pct(avg("f1"))}  first page ${pct(avg("first"))}  latency ${Math.round(avg("ms"))} ms  cost/search $${avg("cost").toFixed(5)}`);
}
console.log(`Model: ${modelSeen}`);
if (modelSeen.startsWith("gemini") && !process.env.EVAL_PRICE_INPUT) console.log("(cost below uses Haiku prices; set EVAL_PRICE_* for Gemini)");
report("Tuning set", rows.slice(0, rows.length - holdout));
report("Held out", rows.slice(rows.length - holdout));

await resetCompany("acme");
