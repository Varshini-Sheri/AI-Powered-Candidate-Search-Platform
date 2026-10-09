"use client";
import Link from "next/link";
import { useData } from "./data";
import { Sheet, btn } from "./ui";

/**
 * Upgrade prompt. Only a Stripe subscription can change the plan, so this
 * explains how to upgrade. With `paywall`, it is shown when a free search is
 * needed but used up, and leads to the Plan & billing page.
 */
export function UpgradeDialog({ open, onOpenChange, paywall = false }: { open: boolean; onOpenChange: (o: boolean) => void; paywall?: boolean }) {
  const { plan } = useData();
  const paid = plan?.plan === "paid";

  if (paywall) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title="Upgrade to run this search">
        <div className="space-y-4 text-[15px] leading-relaxed">
          <p className="text-muted">
            You've used your free search. The paid plan gives everyone at your company unlimited searches.
          </p>
          <p className="text-muted">Your brief is kept, and your results, shortlists and saved searches stay as they are.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/account" className={btn.primary} onClick={() => onOpenChange(false)}>
              Upgrade
            </Link>
            <button className={btn.secondary} onClick={() => onOpenChange(false)}>
              Not now
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={paid ? "You're on the paid plan" : "How to upgrade"}>
      {paid ? (
        <p className="text-[15px] leading-relaxed text-muted">Your company's subscription is active, so searches are unlimited.</p>
      ) : (
        <div className="space-y-4 text-[15px] leading-relaxed">
          <p className="text-muted">
            Ask whoever manages billing at your company to start a subscription. Billing runs through Stripe, and your plan
            switches to paid automatically as soon as the subscription is active.
          </p>
          <p className="text-muted">Your shortlists, saved searches and your free search's results all stay as they are.</p>
          <div className="pt-1">
            <button className={btn.primary} onClick={() => onOpenChange(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
