// Stripe webhooks: signature checks, repeats, out-of-order delivery and
// cancellations, checking /api/plan after each event.
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { call, check, finish, resetCompany, section, service, signIn } from "./lib";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_rotto_assessment_sample";
const acme = await signIn("acme");
const globex = await signIn("globex");
const planOf = async (t: string) => (await call("/api/plan", t)).body.plan as string;

function signed(event: object, secret = SECRET) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  return { body, signature: `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}` };
}
const post = (body: string, signature?: string) =>
  call("/api/billing/events", null, "POST", body, { "Content-Type": "application/json", ...(signature ? { "Stripe-Signature": signature } : {}) });
const event = (id: string, type: string, created: number, sub: string, status: string, company = "acme") =>
  ({ id, object: "event", type, created, data: { object: { id: sub, object: "subscription", status, metadata: { company } } } });

async function reset() {
  await resetCompany("acme");
  await resetCompany("globex");
  await service.from("stripe_events").delete().neq("event_id", "");
}

section("The sample events, in delivery order");
await reset();
const path = "data/stripe-events.json";
if (existsSync(path)) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const list: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw.events;
  for (const e of list) {
    // Send the stored body byte for byte: it is what was signed. Re-serializing breaks the signature.
    const stored = e.payload ?? e.body;
    const body = typeof stored === "string" ? stored : JSON.stringify(stored);
    const sig = String(e.signature ?? e.stripe_signature ?? (e.headers as Record<string, string> | undefined)?.["Stripe-Signature"] ?? (e.headers as Record<string, string> | undefined)?.["stripe-signature"] ?? "");
    const r = await post(body, sig);
    const ev = JSON.parse(body);
    console.log(`  ${r.status} ${e.description ?? ""}: ${ev.id} ${ev.type} created=${ev.created} status=${ev.data?.object?.status} -> ${r.body?.outcome}; acme=${await planOf(acme)} globex=${await planOf(globex)}`);
    check(r.status === 200, `accepted: ${e.description ?? ev.id}`, r.body);
  }
  const expected = raw.expected_plans_after as Record<string, string> | undefined;
  if (expected) {
    check((await planOf(acme)) === expected.acme && (await planOf(globex)) === expected.globex,
      `plans after the sample match expected_plans_after (${JSON.stringify(expected)})`);
  }
} else console.log("  (data/stripe-events.json not found, skipped)");

section("Signatures");
await reset();
const good = signed(event("evt_sig_1", "customer.subscription.created", 1000, "sub_t1", "active"));
check((await post(good.body)).status === 400, "missing Stripe-Signature -> 400");
check((await post(good.body, "t=1,v1=deadbeef")).status === 400, "wrong signature -> 400");
check((await post(good.body.replace("active", "trialing"), good.signature)).status === 400, "tampered body -> 400");
check((await post(good.body, signed(JSON.parse(good.body), "whsec_wrong").signature)).status === 400, "signed with another secret -> 400");
check((await planOf(acme)) === "free", "plan unchanged by rejected events");

section("Valid, repeat, out of order, cancellation");
check((await post(good.body, good.signature)).status === 200, "valid event -> 200");
check((await planOf(acme)) === "paid", "acme is paid after an active subscription");
const again = await post(good.body, good.signature);
check(again.status === 200 && again.body.outcome === "duplicate", "repeat -> 200, ignored", again.body);
const newer = signed(event("evt_sig_3", "customer.subscription.updated", 3000, "sub_t1", "past_due"));
const older = signed(event("evt_sig_2", "customer.subscription.updated", 2000, "sub_t1", "active"));
await post(newer.body, newer.signature);
check((await planOf(acme)) === "free", "newer past_due -> free");
const o = await post(older.body, older.signature);
check(o.status === 200 && (await planOf(acme)) === "free", "older active arriving late cannot overwrite the newer state", o.body);
const back = signed(event("evt_sig_4", "customer.subscription.updated", 4000, "sub_t1", "active"));
await post(back.body, back.signature);
check((await planOf(acme)) === "paid", "newer active -> paid again");
const del = signed(event("evt_sig_5", "customer.subscription.deleted", 5000, "sub_t1", "canceled"));
await post(del.body, del.signature);
check((await planOf(acme)) === "free", "subscription deleted -> back to free");
const late = signed(event("evt_sig_6", "customer.subscription.updated", 6000, "sub_t1", "active"));
await post(late.body, late.signature);
check((await planOf(acme)) === "free", "a canceled subscription is never reactivated");

section("Same second, and other cases");
const a = signed(event("evt_tie_1", "customer.subscription.created", 7000, "sub_t2", "active"));
const b = signed(event("evt_tie_2", "customer.subscription.deleted", 7000, "sub_t2", "canceled"));
await post(b.body, b.signature);
await post(a.body, a.signature);
check((await planOf(acme)) === "free", "deleted and created in the same second -> canceled wins in either order");
const other = signed({ id: "evt_inv", type: "invoice.paid", created: 8000, data: { object: {} } });
check((await post(other.body, other.signature)).status === 200, "unrelated event type -> 200, ignored");
const stranger = signed(event("evt_x", "customer.subscription.created", 8000, "sub_t3", "active", "initech"));
check((await post(stranger.body, stranger.signature)).status === 200 && (await planOf(acme)) === "free", "unknown company -> 200, ignored");
const g = signed(event("evt_g", "customer.subscription.created", 9000, "sub_t4", "active", "globex"));
await post(g.body, g.signature);
check((await planOf(globex)) === "paid" && (await planOf(acme)) === "free", "each subscription changes only its own company");

await reset();
finish();
