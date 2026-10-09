import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const email = process.argv[2] ?? "recruiter@acme.test";
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "rotto-assessment" }),
});
const j = await r.json();
if (!j.access_token) { console.error(j); process.exit(1); }
console.log(j.access_token);