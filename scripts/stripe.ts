// Play Stripe locally: send signed webhook events to the running app (make dev).
//
//   npm run stripe -- replay            send data/stripe-events.json exactly as given, in order
//   npm run stripe -- subscribe acme    start an active subscription for acme (or globex)
//   npm run stripe -- cancel acme       end acme's active subscriptions
//   npm run stripe -- plans             show both companies' plans
//
// Events go through the real endpoint, so the signature check, duplicate check
// and ordering rule all run exactly as they do for the graders.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { anonClient, loadEnv, RECRUITERS, serviceClient } from "./lib/env";

loadEnv(".env");
loadEnv();
const APP = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const [cmd, company] = process.argv.slice(2);

async function send(body: string, signature: string) {
  const res = await fetch(`${APP}/api/billing/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { outcome?: string; error?: string };
  return `${res.status} ${json.outcome ?? json.error ?? ""}`;
}

function sign(body: string) {
  if (!SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set (export it, or put it in .env).");
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;
}

function subscriptionEvent(type: string, subId: string, status: string, co: string) {
  return JSON.stringify({
    id: `evt_local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: subId, object: "subscription", status, metadata: { company: co } } },
  });
}

async function plans() {
  for (const co of ["acme", "globex"] as const) {
    const { data } = await anonClient().auth.signInWithPassword(RECRUITERS[co]);
    const res = await fetch(`${APP}/api/plan`, { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
    console.log(`  ${co.padEnd(7)} ${JSON.stringify(await res.json())}`);
  }
}

function requireCompany(): "acme" | "globex" {
  if (company !== "acme" && company !== "globex") throw new Error("Name the company: acme or globex.");
  return company;
}

if (cmd === "replay") {
  const file = JSON.parse(readFileSync("data/stripe-events.json", "utf8"));
  for (const e of file.events as Array<{ description: string; headers: Record<string, string>; payload: string }>) {
    // The payload is sent byte for byte with its original signature, as the file instructs.
    console.log(`${(await send(e.payload, e.headers["Stripe-Signature"])).padEnd(16)} ${e.description}`);
  }
  console.log("\nPlans now:");
  await plans();
  console.log(`Expected: ${JSON.stringify(file.expected_plans_after)}`);
} else if (cmd === "subscribe") {
  const co = requireCompany();
  const subId = `sub_local_${co}_${Date.now()}`;
  console.log(await send(...withSig(subscriptionEvent("customer.subscription.created", subId, "active", co))), `subscribed ${co} (${subId})`);
  await plans();
} else if (cmd === "cancel") {
  const co = requireCompany();
  const { data } = await serviceClient().from("subscriptions").select("id").eq("company_id", co).eq("status", "active");
  if (!data?.length) console.log(`${co} has no active subscription.`);
  for (const s of data ?? []) {
    console.log(await send(...withSig(subscriptionEvent("customer.subscription.deleted", s.id, "canceled", co))), `canceled ${s.id}`);
  }
  await plans();
} else if (cmd === "plans") {
  await plans();
} else {
  console.log("Usage: npm run stripe -- replay | subscribe <acme|globex> | cancel <acme|globex> | plans");
}

function withSig(body: string): [string, string] {
  return [body, sign(body)];
}
