import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe signature check, written out so every line can be explained:
// header "t=<unix seconds>,v1=<hex>[,v1=<hex>...]"; the signature is
// HMAC-SHA256 over "<t>.<raw body>" keyed with the endpoint secret.

export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds: number | null,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t") timestamp = v ?? null;
    if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;

  // Optional replay window. Off by default because recorded events are replayed
  // long after they were signed; event-id idempotency already stops replays.
  if (toleranceSeconds !== null && Math.abs(now - Number(timestamp)) > toleranceSeconds) return false;

  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex"), "utf8");
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
