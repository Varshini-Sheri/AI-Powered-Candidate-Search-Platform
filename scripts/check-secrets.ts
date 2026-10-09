// After `next build`: fail if any secret value or secret-looking key appears in
// the files the browser downloads.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./lib/env";

loadEnv();
// Exact secret values, plus anything shaped like a real key. Bare prefixes are
// not enough: supabase-js itself contains the literal "sb_secret_" in a check.
const values = [process.env.SUPABASE_SECRET_KEY, process.env.ANTHROPIC_API_KEY, process.env.GEMINI_API_KEY, process.env.STRIPE_WEBHOOK_SECRET]
  .filter((n): n is string => !!n && n.length > 8);
const shapes = [/sb_secret_[A-Za-z0-9_-]{16,}/, /sk-ant-[A-Za-z0-9_-]{16,}/, /AIza[0-9A-Za-z_-]{30,}/, /whsec_[A-Za-z0-9_]{8,}/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = [...walk(".next/static"), ...walk(".next/server/app").filter((f) => f.endsWith(".html") || f.endsWith(".rsc"))];
let leaks = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const v of values) {
    if (text.includes(v)) {
      leaks++;
      console.error(`LEAK: a secret value (${v.slice(0, 6)}...) found in ${f}`);
    }
  }
  for (const re of shapes) {
    const m = text.match(re);
    if (m) {
      leaks++;
      console.error(`LEAK: key-shaped string ${m[0].slice(0, 12)}... found in ${f}`);
    }
  }
}
console.log(leaks ? `${leaks} leak(s) found` : `No secrets in ${files.length} client-facing files.`);
process.exit(leaks ? 1 : 0);
