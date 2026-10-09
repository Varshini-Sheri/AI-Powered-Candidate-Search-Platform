"use client";
import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

interface AuthState {
  session: Session | null;
  ready: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ session: null, ready: false, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = browserSupabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // Forget what this tab was viewing, so the next sign-in starts on a blank search.
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith("scout:")) sessionStorage.removeItem(k);
    } catch {}
    await browserSupabase().auth.signOut();
    setSession(null);
  };

  return <AuthContext.Provider value={{ session, ready, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Renders children only for a signed-in recruiter; otherwise goes to sign in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (ready && !session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [ready, session, router, pathname]);
  if (!ready || !session) return null;
  return <>{children}</>;
}
