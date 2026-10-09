import "server-only";

// Server-only configuration. None of these values is ever sent to the browser:
// only NEXT_PUBLIC_* variables can be, and no secret uses that prefix.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  publishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  secretKey: () => required("SUPABASE_SECRET_KEY"),
  anthropicKey: () => process.env.ANTHROPIC_API_KEY ?? null,
  geminiKey: () => process.env.GEMINI_API_KEY ?? null,
  /**
   * Which model provider to call. LLM_PROVIDER wins; otherwise whichever key is
   * set, preferring Anthropic.
   */
    /**
   * Which model provider to call. LLM_PROVIDER wins; otherwise Gemini, the
   * declared model. Anthropic is used only when it is the one key present.
   */
  provider: (): "anthropic" | "gemini" => {
    const p = process.env.LLM_PROVIDER;
    if (p === "anthropic" || p === "gemini") return p;
    return process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY ? "anthropic" : "gemini";
  },
  model: () =>
    process.env.LLM_MODEL ||
    (serverEnv.provider() === "gemini" ? "gemini-3.5-flash-lite" : "claude-haiku-5-5"),
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET ?? null,
  /** Optional replay window in seconds. Unset = no timestamp check (see README). */
  stripeToleranceSeconds: () => {
    const v = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS);
    return Number.isFinite(v) && v > 0 ? v : null;
  },
};
