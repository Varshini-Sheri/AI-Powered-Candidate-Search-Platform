// Shared helpers for the test suites. They run against a live app (make dev)
// and the local Supabase stack. Some setup steps use the secret key to reset
// test state; that key is read from .env.local and only ever used here.
import { anonClient, loadEnv, RECRUITERS, serviceClient } from "../scripts/lib/env";

loadEnv();
export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
export const service = serviceClient();

let failures = 0;
let passes = 0;
export function check(ok: boolean, label: string, detail?: unknown): void {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
}
export function section(name: string): void {
  console.log(`\n${name}`);
}
export function finish(): never {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

export async function signIn(company: keyof typeof RECRUITERS): Promise<string> {
  const { email, password } = RECRUITERS[company];
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

export async function call(path: string, token: string | null, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const ms = performance.now() - started;
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, ms };
}

/** Test-only reset: remove a company's searches and subscriptions. */
export async function resetCompany(company: "acme" | "globex") {
  await service.from("searches").delete().eq("company_id", company);
  await service.from("subscriptions").delete().eq("company_id", company);
}

/** Test-only: put a company on the paid plan with a fake active subscription. */
export async function makePaid(company: "acme" | "globex") {
  await service.from("subscriptions").upsert({ id: `sub_test_${company}`, company_id: company, status: "active", last_event_created: 1, last_event_id: "evt_test" });
}

export async function pageAll(token: string, searchId: string, total: number) {
  const ids: string[] = [];
  const timings: number[] = [];
  const pages = Math.max(1, Math.ceil(total / 20));
  for (let p = 1; p <= pages + 1; p++) {
    const r = await call(`/api/search/${searchId}?page=${p}`, token);
    timings.push(r.ms);
    if (r.status !== 200) throw new Error(`page ${p} -> ${r.status}`);
    ids.push(...r.body.results.map((x: { id: string }) => x.id));
  }
  return { ids, timings };
}

export const anon = anonClient;
