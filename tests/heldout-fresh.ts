// FRESH held-out set: 24 briefs written after all tuning, never used to change the app.
// Run it, report the number, and do NOT change search because of it: that keeps it an
// honest estimate of accuracy on briefs the system has never seen.
// Correct answers are computed straight from data/candidates.json with the same kind of
// rules that reproduce all 10 sample answers in tests/heldout.ts.
//
// Usage: npx tsx tests/heldout-fresh.ts            (one run)
//        npx tsx tests/heldout-fresh.ts --runs 2

import { readFileSync } from "node:fs";
import { call, makePaid, pageAll, service, signIn } from "./lib";

interface Cand {
  id: string; role: string; seniority: string; years_experience: number; open_to_work: boolean; skills: string[];
  location: { city: string };
  experiences: Array<{ company_type: string; end_year: number | null }>;
  education: Array<{ school: string; degree: string; field: string }>;
}
const people: Cand[] = JSON.parse(readFileSync("data/candidates.json", "utf8"));
type P = (c: Cand) => boolean;
const all = (...ps: P[]): P => (c) => ps.every((p) => p(c));
const role = (...r: string[]): P => (c) => r.includes(c.role);
const engineer: P = (c) => /Engineer$/.test(c.role);
const sen = (s: string): P => (c) => c.seniority === s;
const city = (x: string): P => (c) => c.location.city === x;
const skill = (...s: string[]): P => (c) => s.every((x) => c.skills.includes(x));
const anySkill = (...s: string[]): P => (c) => s.some((x) => c.skills.includes(x));
const open: P = (c) => c.open_to_work;
const everAt = (t: string): P => (c) => c.experiences.some((e) => e.company_type === t);
const nowAt = (t: string): P => (c) => c.experiences.some((e) => e.end_year === null && e.company_type === t);
const not = (p: P): P => (c) => !p(c);
const school = (s: string): P => (c) => c.education.some((e) => e.school === s);
const degree = (d: string): P => (c) => c.education.some((e) => e.degree === d);
const field = (f: string): P => (c) => c.education.some((e) => e.field === f);
const yearsMin = (n: number): P => (c) => c.years_experience >= n;
const nobody: P = () => false;

const CASES: Array<[string, P]> = [
  ["staff data engineers in San Francisco", all(role("Data Engineer"), sen("staff"), city("San Francisco"))],
  ["junior mobile engineers who know Flutter", all(role("Mobile Engineer"), sen("junior"), skill("Flutter"))],
  ["senior DevOps engineers who know Kubernetes and Terraform", all(role("DevOps Engineer"), sen("senior"), skill("Kubernetes", "Terraform"))],
  ["full stack engineers in Denver who know Next.js", all(role("Full Stack Engineer"), city("Denver"), skill("Next.js"))],
  ["backend engineers who know Rust or Go", all(role("Backend Engineer"), anySkill("Rust", "Go"))],
  ["machine learning engineers in Seattle who know TensorFlow", all(role("Machine Learning Engineer"), city("Seattle"), skill("TensorFlow"))],
  ["data scientists who know R and Statistics", all(role("Data Scientist"), skill("R", "Statistics"))],
  ["product designers who know Figma, in Austin", all(role("Product Designer"), skill("Figma"), city("Austin"))],
  ["recruiters who know Greenhouse", all(role("Recruiter"), skill("Greenhouse"))],
  ["marketing managers in Miami who are open to work", all(role("Marketing Manager"), city("Miami"), open)],
  ["account executives who know HubSpot", all(role("Account Executive"), skill("HubSpot"))],
  ["senior product managers who have worked at a startup", all(role("Product Manager"), sen("senior"), everAt("startup"))],
  ["frontend engineers currently at a startup", all(role("Frontend Engineer"), nowAt("startup"))],
  ["engineers who studied at Georgia Tech", all(engineer, school("Georgia Tech"))],
  ["data scientists who went to Columbia", all(role("Data Scientist"), school("Columbia University"))],
  ["machine learning engineers with an MS", all(role("Machine Learning Engineer"), degree("MS"))],
  ["designers who studied Human-Computer Interaction", all(role("Product Designer"), field("Human-Computer Interaction"))],
  ["backend engineers with at least 10 years of experience", all(role("Backend Engineer"), yearsMin(10))],
  ["mobile engineers in Atlanta", all(role("Mobile Engineer"), city("Atlanta"))],
  ["senior frontend engineers in Los Angeles, ideally with Svelte", all(role("Frontend Engineer"), sen("senior"), city("Los Angeles"))],
  ["data engineers who know Kafka but have never worked at an enterprise", all(role("Data Engineer"), skill("Kafka"), not(everAt("enterprise")))],
  ["devops engineers in Chicago who are open to work", all(role("DevOps Engineer"), city("Chicago"), open)],
  ["product managers fluent in Spanish", nobody],
  ["engineers with a GitHub portfolio", nobody],
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
const rows: Array<{ brief: string; p: number; r: number; f1: number; first: number; got: number; exp: number; filters: string }> = [];
try {
  for (let run = 1; run <= runs; run++) {
    for (const [brief, rule] of CASES) {
      const gold = new Set(people.filter(rule).map((c) => c.id));
      const s = await call("/api/search", token, "POST", { brief });
      if (s.status !== 200) {
        rows.push({ brief, p: 0, r: 0, f1: 0, first: 0, got: -1, exp: gold.size, filters: `HTTP ${s.status}` });
        continue;
      }
      const ours = (await pageAll(token, s.body.search_id, s.body.total)).ids;
      const hit = ours.filter((id) => gold.has(id)).length;
      const P = ours.length ? hit / ours.length : gold.size ? 0 : 1;
      const R = gold.size ? hit / gold.size : ours.length ? 0 : 1;
      const F = P + R ? (2 * P * R) / (P + R) : 0;
      const den = Math.min(20, gold.size);
      const first = den ? ours.slice(0, 20).filter((id) => gold.has(id)).length / den : ours.length ? 0 : 1;
      rows.push({ brief, p: P, r: R, f1: F, first, got: ours.length, exp: gold.size, filters: describe(s.body.filters) });
    }
  }
} finally {
  if (!existing) await service.from("subscriptions").delete().eq("id", "sub_test_acme");
}
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);
const mean = (k: "p" | "r" | "f1" | "first") => rows.reduce((a, b) => a + b[k], 0) / rows.length;
console.log("Briefs under 100% F1:");
for (const w of rows.filter((x) => x.f1 < 1)) console.log(`  F1 ${pct(w.f1)}  P ${pct(w.p)}  R ${pct(w.r)}  got ${w.got} / right ${w.exp}  ${w.brief}\n        ${w.filters}`);
console.log(`\nFresh held-out (${CASES.length} briefs x ${runs}, never used for tuning): P ${pct(mean("p"))}  R ${pct(mean("r"))}  F1 ${pct(mean("f1"))}  first page ${pct(mean("first"))}`);