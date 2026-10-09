// Loads data/candidates.json into Postgres with normalized, indexed columns and
// builds the vocabulary table the search mapper uses. Idempotent (upserts).
import { readFileSync } from "node:fs";
import { candidateRow, candidatesFromFile, type CandidateRow } from "../src/lib/candidate-record";
import { companyKey, simpleKey, skillKey, titleCase } from "../src/lib/normalize";
import { serviceClient } from "./lib/env";

const file = process.argv[2] ?? "data/candidates.json";
const raw = candidatesFromFile(JSON.parse(readFileSync(file, "utf8")));
const rows: CandidateRow[] = raw.map(candidateRow);

const ids = new Set<string>();
for (const r of rows) {
  if (!r.id || r.id === "undefined") throw new Error("A candidate has no id");
  if (ids.has(r.id)) throw new Error(`Duplicate candidate id ${r.id}`);
  ids.add(r.id);
}

// Vocabulary: every value that exists in the data, with its most common label.
type Entry = { labels: Map<string, number>; count: number };
const vocab = new Map<string, Map<string, Entry>>();
function add(kind: string, key: string | null | undefined, label: string) {
  if (!key) return;
  const byKind = vocab.get(kind) ?? new Map<string, Entry>();
  vocab.set(kind, byKind);
  const e = byKind.get(key) ?? { labels: new Map(), count: 0 };
  e.count++;
  e.labels.set(label, (e.labels.get(label) ?? 0) + 1);
  byKind.set(key, e);
}

for (const r of rows) {
  for (const label of r.skills) add("skill", skillKey(label), label);
  for (const t of r.title_bases) add("title", t, titleCase(t));
  for (const t of r.location_terms) add("location", t, t.startsWith("state:") ? `${titleCase(t.slice(6))} (state)` : titleCase(t));
  for (const e of r.profile.experience) if (e.company) add("company", companyKey(e.company), e.company);
  for (const t of r.traits) add("trait", t, titleCase(t));
  for (const e of r.profile.education) {
    if (e.school) add("school", simpleKey(e.school), e.school);
    if (e.field) add("field_of_study", simpleKey(e.field), e.field);
  }
}

const vocabRows = [...vocab].flatMap(([kind, byKind]) =>
  [...byKind].map(([key, e]) => ({
    kind,
    key,
    label: [...e.labels].sort((a, b) => b[1] - a[1])[0][0],
    count: e.count,
  })),
);

const db = serviceClient();

async function upsertAll(table: string, data: object[], onConflict: string) {
  for (let i = 0; i < data.length; i += 500) {
    const { error } = await db.from(table).upsert(data.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

await upsertAll("candidates", rows, "id");
await db.from("vocab").delete().neq("kind", "");
await upsertAll("vocab", vocabRows, "kind,key");

const counts = Object.fromEntries([...vocab].map(([k, v]) => [k, v.size]));
console.log(`Loaded ${rows.length} candidates. Vocabulary:`, counts);
if (!vocab.get("trait")?.has("startup")) {
  console.log("Note: no explicit startup field found in the data, so 'startup' briefs will report it as unsupported.");
}
