"use client";
import { useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/components/auth";
import { useData } from "@/components/data";
import { btn } from "@/components/ui";
import { UpgradeDialog } from "@/components/upgrade";
import type { Plan } from "@/lib/types";

const CURRENT = "border-2 border-marker bg-marker-soft";
const OTHER = "border border-line bg-surface";

function Account() {
  const { session, signOut } = useAuth();
  const { company, plan, refreshPlan } = useData();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const paid = plan?.plan === "paid";
  const left = plan?.searches_remaining ?? 0;

  async function check() {
    setChecking(true);
    setNote(null);
    try {
      await refreshPlan();
      const p = await api<Plan>("/api/plan");
      setNote(p.plan === "paid" ? "Your subscription is active." : "Still on the free plan. No active subscription has come through from Stripe yet.");
    } catch {
      setNote("Couldn't check your plan just now. Try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] md:text-[26px]">Plan & billing</h1>

      <section aria-labelledby="you-h">
        <h2 id="you-h" className="mb-3 text-[15px] font-semibold">Your account</h2>
        <dl className="card divide-y divide-line text-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-muted">Email</dt>
            <dd className="truncate font-medium">{session?.user.email}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-muted">Company</dt>
            <dd className="font-medium">{company ?? "…"}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="plan-h">
        <h2 id="plan-h" className="mb-3 text-[15px] font-semibold">Plan</h2>
        {!plan ? (
          <span className="skeleton block h-28 rounded-xl" />
        ) : (
          // Whichever plan the company is on is highlighted and marked Current.
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-xl p-4 ${!paid ? CURRENT : OTHER}`}>
              <p className="flex items-center justify-between text-sm font-medium">
                <span className={!paid ? "text-marker" : ""}>Free plan</span>
                {!paid && <span className="rounded-full bg-marker px-2 py-0.5 text-xs text-white">Current</span>}
              </p>
              <p className="mt-2 text-sm text-muted">One search for your company. Browsing, shortlisting and narrowing its results stay free.</p>
              {!paid && <p className="mt-3 text-sm font-medium">{left === 1 ? "1 search left" : `${left} searches left`}</p>}
            </div>
            <div className={`rounded-xl p-4 ${paid ? CURRENT : OTHER}`}>
              <p className="flex items-center justify-between text-sm font-medium">
                <span className={paid ? "text-marker" : ""}>Paid plan</span>
                {paid && <span className="rounded-full bg-marker px-2 py-0.5 text-xs text-white">Current</span>}
              </p>
              <p className="mt-2 text-sm text-muted">Unlimited searches for everyone at your company.</p>
              {!paid && (
                <button className={`${btn.primary} mt-4`} onClick={() => setUpgrade(true)}>
                  Upgrade
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="billing-h">
        <h2 id="billing-h" className="mb-3 text-[15px] font-semibold">Billing</h2>
        <div className="card p-5 text-sm leading-relaxed text-muted">
          {paid ? (
            <p>Your company's Stripe subscription is active. To cancel, ask whoever manages billing to cancel it in Stripe. When it ends, your company moves back to the free plan automatically.</p>
          ) : (
            <p>
              To upgrade, ask whoever manages billing at your company to start a subscription. Billing runs through Stripe, and
              this page switches to the paid plan as soon as the subscription is active.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className={btn.secondary} onClick={check} disabled={checking}>
              {checking ? "Checking…" : "Check my plan again"}
            </button>
            {note && <p role="status" className="text-sm text-ink">{note}</p>}
          </div>
        </div>
      </section>

      <section>
        <button className={btn.secondary} onClick={signOut}>
          Sign out
        </button>
      </section>

      <UpgradeDialog open={upgrade} onOpenChange={setUpgrade} />
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppShell>
      <Account />
    </AppShell>
  );
}
