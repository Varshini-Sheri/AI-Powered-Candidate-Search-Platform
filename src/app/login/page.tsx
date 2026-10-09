"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/auth";
import { btn, input } from "@/components/ui";
import { browserSupabase } from "@/lib/supabase-browser";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const { session, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace(target);
  }, [ready, session, router, target]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await browserSupabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === "Invalid login credentials" ? "That email and password don't match. Check them and try again." : error.message);
    else router.replace(target);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">Scout<span className="text-marker">.</span></h1>
        <p className="mt-1 text-[15px] text-muted">Sign in to search candidates for your company.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Work email</span>
            <input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Password</span>
            <input className={input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-stop">{error}</p>}
          <button type="submit" className={`${btn.primary} w-full`} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
