import { NextResponse } from "next/server";
import { verifyStripeSignature } from "@/server/billing/verify";
import { serverEnv } from "@/server/env";
import { serviceClient } from "@/server/supabase";

/**
 * POST /api/billing/events: Stripe webhooks (no recruiter token).
 * 400 for a bad signature, 200 otherwise, including repeats and stale events.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = serverEnv.stripeWebhookSecret();
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set; rejecting webhook.");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const raw = await req.text(); // the exact bytes Stripe signed; parse only after verifying
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret, serverEnv.stripeToleranceSeconds())) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { data, error } = await serviceClient().rpc("apply_stripe_event", { p_event: event });
  if (error) {
    console.error("apply_stripe_event failed:", error.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 }); // Stripe will retry
  }
  return NextResponse.json({ received: true, outcome: data });
}
