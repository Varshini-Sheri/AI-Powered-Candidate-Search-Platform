// Every successful search must be pageable: page 1 returns 200, even when total is 0.
// Runs a few briefs several times and prints anything that breaks that.
// Usage: npx tsx tests/page-check.ts            (5 runs each)
import { call, makePaid, service, signIn } from "./lib";

const BRIEFS = [
  "engineers not currently at Google",
  "great people who would fit our culture", // unsupported only: 0 results
  "software engineers under 30 years old", // unsupported required: 0 results
  "product managers who speak Japanese", // unsupported required: 0 results
  "'; DROP TABLE candidates; --",
];
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 5;

const { data: existing } = await service.from("subscriptions").select("id").eq("id", "sub_test_acme").maybeSingle();
await makePaid("acme");
const token = await signIn("acme");
let bad = 0;
try {
  for (const brief of BRIEFS) {
    for (let i = 1; i <= runs; i++) {
      const s = await call("/api/search", token, "POST", { brief });
      if (s.status !== 200) {
        console.log(`  search ${s.status}  "${brief}"  ${JSON.stringify(s.body).slice(0, 120)}`);
        continue;
      }
      const { search_id, total, filters } = s.body;
      const p = await call(`/api/search/${search_id}?page=1`, token);
      const ok = p.status === 200 && Array.isArray(p.body?.results);
      if (!ok) bad++;
      const f = JSON.stringify({ c: filters?.constraints?.map((c: any) => `${c.mode}:${c.field}${c.scope ? `(${c.scope})` : ""}=${(c.values ?? []).join("|")}`), u: filters?.unsupported?.map((u: any) => `${u.mode}:${u.text}`) });
      console.log(`${ok ? "ok  " : "FAIL"} run ${i}  total=${String(total).padStart(4)}  id=${String(search_id).slice(0, 8)}  page1=${p.status}  "${brief}"  ${f}`);
    }
  }
} finally {
  if (!existing) await service.from("subscriptions").delete().eq("id", "sub_test_acme");
}
console.log(bad ? `\n${bad} searches could not be paged` : "\nevery search was pageable");
process.exit(bad ? 1 : 0);