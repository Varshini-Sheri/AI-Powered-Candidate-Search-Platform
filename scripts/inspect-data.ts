// Build step 1: look at the real data before trusting the parser.
// Prints field inventories for candidates.json, the Stripe event orderings in
// stripe-events.json (including same-second ties), and the queries.json shape.
import { existsSync, readFileSync } from "node:fs";
import { candidateRow, candidatesFromFile } from "../src/lib/candidate-record";

function load(path: string): unknown | null {
  if (!existsSync(path)) {
    console.log(`\n(${path} not found)`);
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function keyCounts(items: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) if (it && typeof it === "object") for (const k of Object.keys(it)) out[k] = (out[k] ?? 0) + 1;
  return out;
}

function top(values: unknown[], n = 15): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = typeof v === "string" ? v : JSON.stringify(v);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// candidates.json
const c = load("data/candidates.json");
if (c) {
  const raw = candidatesFromFile(c);
  console.log(`\n=== candidates.json: ${raw.length} records ===`);
  console.log("Top-level fields:", keyCounts(raw));
  console.log("First record:", JSON.stringify(raw[0], null, 2).slice(0, 2500));
  const nested = (k: string[]) => raw.flatMap((r) => k.flatMap((key) => (Array.isArray(r[key]) ? (r[key] as unknown[]) : [])));
  const jobs = nested(["work_history", "experience", "experiences", "work_experience", "jobs", "positions", "employment"]);
  const edus = nested(["education", "educations", "schools"]);
  console.log("Work history fields:", keyCounts(jobs));
  console.log("Education fields:", keyCounts(edus));
  for (const [field, n] of Object.entries(keyCounts(jobs))) {
    if (/type|stage|size|startup|category|funding|industry|employees/i.test(field)) {
      console.log(`Work history '${field}' (${n}):`, top(jobs.map((j) => (j as Record<string, unknown>)[field])));
    }
  }
  console.log("Location samples:", top(raw.map((r) => r.location), 10));
  const rows = raw.map(candidateRow);
  console.log("Seniority:", top(rows.map((r) => r.seniority)));
  console.log("Role families:", top(rows.flatMap((r) => r.role_families)));
  console.log("Top current titles:", top(rows.map((r) => r.current_title), 25));
  console.log("Top skills:", top(rows.flatMap((r) => r.skills), 25));
  console.log("Traits found:", top(rows.flatMap((r) => r.traits)));
  console.log("Years range:", Math.min(...rows.map((r) => r.years_experience ?? 99)), "to", Math.max(...rows.map((r) => r.years_experience ?? 0)));
  console.log("Missing: avatar", rows.filter((r) => !r.avatar_url).length, "| current company", rows.filter((r) => !r.current_company).length, "| location", rows.filter((r) => !r.location_terms.length).length);
}

// stripe-events.json
const s = load("data/stripe-events.json");
if (s) {
  const list = (Array.isArray(s) ? s : ((s as Record<string, unknown>).events as unknown[])) ?? [];
  console.log(`\n=== stripe-events.json: ${list.length} entries ===`);
  console.log("Entry fields:", keyCounts(list));
  const events = list.map((e) => {
    const o = e as Record<string, unknown>;
    const stored = o.payload ?? o.body ?? o;
    const body = typeof stored === "string" ? stored : JSON.stringify(stored);
    return JSON.parse(body) as { id: string; type: string; created: number; data: { object: Record<string, unknown> } };
  });
  console.log("Types:", top(events.map((e) => e.type)));
  const bySub = new Map<string, typeof events>();
  for (const e of events) {
    const id = String(e.data?.object?.id ?? "?");
    bySub.set(id, [...(bySub.get(id) ?? []), e]);
  }
  for (const [sub, evs] of bySub) {
    console.log(`\n${sub} (${(evs[0].data.object.metadata as Record<string, string>)?.company}):`);
    for (const e of evs) console.log(`  delivered: ${e.id}  ${e.type}  created=${e.created}  status=${e.data.object.status}`);
    const distinct = [...new Map(evs.map((e) => [e.id, e])).values()]; // a repeat of the same event is not a tie
    const seconds = top(distinct.map((e) => e.created)).filter(([, n]) => n > 1);
    if (seconds.length) console.log("  SAME-SECOND events at:", seconds, " -> check the tie rule");
  }
  if (!Array.isArray(s)) console.log("\nexpected_plans_after:", (s as Record<string, unknown>).expected_plans_after);
  console.log("\nObject fields available for tie-breaking:", Object.keys(events[0]?.data?.object ?? {}).join(", "));
}

// queries.json
const q = load("data/queries.json");
if (q) {
  const list = (Array.isArray(q) ? q : ((q as Record<string, unknown>).queries as unknown[])) ?? [];
  console.log(`\n=== queries.json: ${list.length} briefs ===`);
  for (const item of list) {
    const o = item as Record<string, unknown>;
    console.log(`- ${o.brief ?? o.query}  (${(o.expected_ids as unknown[] | undefined)?.length ?? "?"} expected)`);
  }
}
