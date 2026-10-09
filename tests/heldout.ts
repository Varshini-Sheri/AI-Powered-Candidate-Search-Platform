// Held-out accuracy on briefs the app has never seen, scored the way grading does.
//
// The correct people for each brief are computed straight from data/candidates.json with
// a plain rule, independent of the app. To make sure these rules mean what the graders
// mean, step 1 applies the same kind of rule to the 10 sample briefs and compares with
// their expected_ids from data/queries.json. Step 2 runs the new briefs through
// POST /api/search, pages to the end, and scores precision, recall, F1 and first page.
//
// Usage: npx tsx tests/heldout.ts            (one run)
//        npx tsx tests/heldout.ts --runs 2   (catches flaky readings)

import { readFileSync } from "node:fs";
import { call, makePaid, pageAll, service, signIn } from "./lib";

interface Cand {
  id: string; role: string; seniority: string; years_experience: number; open_to_work: boolean; skills: string[];
  location: { city: string; state: string; country: string };
  experiences: Array<{ company: string; company_type: string; end_year: number | null; title: string }>;
  education: Array<{ school: string; degree: string; field: string }>;
}
const people: Cand[] = JSON.parse(readFileSync("data/candidates.json", "utf8"));

// ---------- rule helpers ----------
type P = (c: Cand) => boolean;
const all = (...ps: P[]): P => (c) => ps.every((p) => p(c));
const role = (...r: string[]): P => (c) => r.includes(c.role);
const engineer: P = (c) => /Engineer$/.test(c.role);
const sen = (s: string): P => (c) => c.seniority === s;
const city = (x: string): P => (c) => c.location.city === x;
const state = (x: string): P => (c) => c.location.state === x;
const skill = (...s: string[]): P => (c) => s.every((x) => c.skills.includes(x));
const anySkill = (...s: string[]): P => (c) => s.some((x) => c.skills.includes(x));
const open: P = (c) => c.open_to_work;
const everAt = (type: string): P => (c) => c.experiences.some((e) => e.company_type === type);
const nowAt = (type: string): P => (c) => c.experiences.some((e) => e.end_year === null && e.company_type === type);
const not = (p: P): P => (c) => !p(c);
const school = (...s: string[]): P => (c) => c.education.some((e) => s.includes(e.school));
const degree = (d: string): P => (c) => c.education.some((e) => e.degree === d);
const field = (f: string): P => (c) => c.education.some((e) => e.field === f);
const yearsMin = (n: number): P => (c) => c.years_experience >= n;
const nobody: P = () => false;
const ids = (p: P) => new Set(people.filter(p).map((c) => c.id));

// ---------- step 1: do these rules agree with the graders on their own samples? ----------
const SAMPLE_RULES: Record<string, P> = {
  "senior React engineers in New York who have worked at a startup": all(engineer, sen("senior"), skill("React"), city("New York"), everAt("startup")),
  "product designers in San Francisco who are open to work": all(role("Product Designer"), city("San Francisco"), open),
  "data scientists with a PhD": all(role("Data Scientist"), degree("PhD")),
  "backend engineers in Austin who know Go and Kubernetes": all(role("Backend Engineer"), city("Austin"), skill("Go", "Kubernetes")),
  "staff full stack engineers in Seattle": all(role("Full Stack Engineer"), sen("staff"), city("Seattle")),
  "machine learning engineers who studied at Stanford": all(role("Machine Learning Engineer"), school("Stanford University")),
  "account executives in Chicago with enterprise sales experience": all(role("Account Executive"), city("Chicago"), skill("Enterprise Sales")),
  "junior frontend engineers in Boston who are open to work": all(role("Frontend Engineer"), sen("junior"), city("Boston"), open),
  "mobile engineers who know Swift": all(role("Mobile Engineer"), skill("Swift")),
  "product managers who speak Japanese": nobody,
};

const raw = JSON.parse(readFileSync("data/queries.json", "utf8"));
const samples: Array<{ brief: string; expected: Set<string> }> = (Array.isArray(raw) ? raw : raw.queries).map((q: any) => ({
  brief: String(q.brief ?? q.query),
  expected: new Set(((q.expected_ids ?? q.expected ?? []) as unknown[]).map(String)),
}));
console.log("Step 1: rule vs graders' expected_ids on the 10 samples");
let calibrated = true;
for (const s of samples) {
  const rule = SAMPLE_RULES[s.brief];
  if (!rule) { console.log(`  (no rule written for "${s.brief}")`); continue; }
  const mine = ids(rule);
  const same = mine.size === s.expected.size && [...mine].every((x) => s.expected.has(x));
  if (!same) calibrated = false;
  const extra = [...mine].filter((x) => !s.expected.has(x)).length;
  const missing = [...s.expected].filter((x) => !mine.has(x)).length;
  console.log(`  ${same ? "match" : "DIFF "}  rule ${mine.size} / expected ${s.expected.size}${same ? "" : `  (+${extra} extra, -${missing} missing)`}  ${s.brief}`);
}
console.log(calibrated ? "  -> rules agree with the graders; held-out answers below are trustworthy\n"
  : "  -> some rules differ: the held-out answers that use the same kind of rule may be off\n");

// ---------- step 2: new briefs in the same style, with their correct rule ----------
const CASES: Array<{ brief: string; rule: P }> = [
  { brief: "senior Python engineers in Seattle who have worked at a startup", rule: all(engineer, sen("senior"), skill("Python"), city("Seattle"), everAt("startup")) },
  { brief: "junior TypeScript engineers in Denver", rule: all(engineer, sen("junior"), skill("TypeScript"), city("Denver")) },
  { brief: "staff backend engineers in New York who know Go", rule: all(role("Backend Engineer"), sen("staff"), city("New York"), skill("Go")) },
  { brief: "mid-level frontend engineers in Chicago who know Vue", rule: all(role("Frontend Engineer"), sen("mid"), city("Chicago"), skill("Vue")) },
  { brief: "senior data scientists in Boston", rule: all(role("Data Scientist"), sen("senior"), city("Boston")) },
  { brief: "staff machine learning engineers who know PyTorch", rule: all(role("Machine Learning Engineer"), sen("staff"), skill("PyTorch")) },
  { brief: "devops engineers in Atlanta", rule: all(role("DevOps Engineer"), city("Atlanta")) },
  { brief: "data engineers in Miami who know Airflow", rule: all(role("Data Engineer"), city("Miami"), skill("Airflow")) },

  { brief: "backend engineers in Seattle who are open to work", rule: all(role("Backend Engineer"), city("Seattle"), open) },
  { brief: "senior product designers in Los Angeles who are open to work", rule: all(role("Product Designer"), sen("senior"), city("Los Angeles"), open) },
  { brief: "recruiters in Denver who are open to work", rule: all(role("Recruiter"), city("Denver"), open) },

  { brief: "machine learning engineers with a PhD", rule: all(role("Machine Learning Engineer"), degree("PhD")) },
  { brief: "product managers with an MBA", rule: all(role("Product Manager"), degree("MBA")) },
  { brief: "data scientists who studied at MIT", rule: all(role("Data Scientist"), school("MIT")) },
  { brief: "frontend engineers who went to Carnegie Mellon", rule: all(role("Frontend Engineer"), school("Carnegie Mellon University")) },
  { brief: "backend engineers who studied at UC Berkeley", rule: all(role("Backend Engineer"), school("UC Berkeley")) },
  { brief: "data engineers who studied computer science", rule: all(role("Data Engineer"), field("Computer Science")) },

  { brief: "backend engineers in Chicago who know Python and Postgres", rule: all(role("Backend Engineer"), city("Chicago"), skill("Python", "Postgres")) },
  { brief: "frontend engineers who know React and TypeScript", rule: all(role("Frontend Engineer"), skill("React", "TypeScript")) },
  { brief: "mobile engineers who know Kotlin or Swift", rule: all(role("Mobile Engineer"), anySkill("Kotlin", "Swift")) },

  { brief: "staff full stack engineers in Austin", rule: all(role("Full Stack Engineer"), sen("staff"), city("Austin")) },
  { brief: "account executives in New York with Salesforce experience", rule: all(role("Account Executive"), city("New York"), skill("Salesforce")) },
  { brief: "marketing managers who know SEO", rule: all(role("Marketing Manager"), skill("SEO")) },
  { brief: "product managers in California", rule: all(role("Product Manager"), state("CA")) },

  { brief: "backend engineers with at least 8 years of experience", rule: all(role("Backend Engineer"), yearsMin(8)) },
  { brief: "data scientists in Boston, ideally with a PhD", rule: all(role("Data Scientist"), city("Boston")) },
  { brief: "senior frontend engineers, preferably in New York", rule: all(role("Frontend Engineer"), sen("senior")) },
  { brief: "backend engineers in Austin who have never worked at a startup", rule: all(role("Backend Engineer"), city("Austin"), not(everAt("startup"))) },
  { brief: "senior engineers currently at an enterprise company", rule: all(engineer, sen("senior"), nowAt("enterprise")) },

  { brief: "designers who speak French", rule: nobody },
  { brief: "backend engineers in Seattle with a security clearance", rule: nobody },
  { brief: "data scientists willing to relocate to London", rule: nobody },
];

const argv = process.argv.slice(2);
const runs = Math.max(1, Number(argv[argv.indexOf("--runs") + 1]) || 1);
const describe = (f: any) =>
  [
    ...(f?.constraints ?? []).map((c: any) => `${c.mode === "required" ? "" : c.mode + ":"}${c.field}${c.scope && c.scope !== "any" ? `(${c.scope})` : ""}=${c.values?.length ? c.values.join("|") : [c.min !== undefined ? `min ${c.min}` : "", c.max !== undefined ? `max ${c.max}` : ""].filter(Boolean).join(" ")}`),
    ...(f?.unsupported ?? []).map((u: any) => `?${u.mode === "required" ? "" : u.mode + ":"}${u.text}`),
  ].join("  ") || "(none)";

const { data: existing } = await service.from("subscriptions").select("id").eq("id", "sub_test_acme").maybeSingle();
await makePaid("acme");
const token = await signIn("acme");

interface Row { brief: string; p: number; r: number; f1: number; first: number; got: number; exp: number; filters: string }
const rows: Row[] = [];
console.log(`Step 2: ${CASES.length} new briefs x ${runs} run(s)`);
try {
  for (let run = 1; run <= runs; run++) {
    for (const c of CASES) {
      const gold = ids(c.rule);
      const s = await call("/api/search", token, "POST", { brief: c.brief });
      if (s.status !== 200) {
        rows.push({ brief: c.brief, p: 0, r: 0, f1: 0, first: 0, got: -1, exp: gold.size, filters: `HTTP ${s.status}` });
        continue;
      }
      const ours = (await pageAll(token, s.body.search_id, s.body.total)).ids;
      const hit = ours.filter((id) => gold.has(id)).length;
      const P = ours.length ? hit / ours.length : gold.size ? 0 : 1;
      const R = gold.size ? hit / gold.size : ours.length ? 0 : 1;
      const F = P + R ? (2 * P * R) / (P + R) : 0;
      const den = Math.min(20, gold.size);
      const first = den ? ours.slice(0, 20).filter((id) => gold.has(id)).length / den : ours.length ? 0 : 1;
      rows.push({ brief: c.brief, p: P, r: R, f1: F, first, got: ours.length, exp: gold.size, filters: describe(s.body.filters) });
    }
  }
} finally {
  if (!existing) await service.from("subscriptions").delete().eq("id", "sub_test_acme");
}

const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);
const mean = (k: keyof Row) => rows.reduce((a, b) => a + (b[k] as number), 0) / rows.length;
const wrong = rows.filter((x) => x.f1 < 1);
console.log("\nBriefs under 100% F1:");
for (const w of wrong) console.log(`  F1 ${pct(w.f1)}  P ${pct(w.p)}  R ${pct(w.r)}  got ${w.got} / right ${w.exp}  ${w.brief}\n        ${w.filters}`);
if (!wrong.length) console.log("  none");
console.log(`\nHeld-out (${CASES.length} briefs x ${runs}): P ${pct(mean("p"))}  R ${pct(mean("r"))}  F1 ${pct(mean("f1"))}  first page ${pct(mean("first"))}${calibrated ? "" : "  (rules not fully calibrated, see step 1)"}`);