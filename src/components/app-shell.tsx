"use client";
import { Bookmark, Search, Star } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { RequireAuth } from "./auth";
import { useData } from "./data";

const NAV = [
  { href: "/", label: "Search", icon: Search },
  { href: "/shortlists", label: "Shortlists", icon: Bookmark },
  { href: "/saved", label: "Saved searches", short: "Saved", icon: Star },
];

export function PlanBadge() {
  const { plan } = useData();
  if (!plan) return <span className="skeleton h-7 w-28 rounded-full" />;
  if (plan.plan === "paid") {
    return (
      <Link href="/account" className="whitespace-nowrap rounded-full bg-[#ecf6f0] px-2.5 py-1 text-xs font-medium text-ok ring-1 ring-inset ring-ok/10 hover:brightness-[.98]">
        Paid plan
      </Link>
    );
  }
  const left = plan.searches_remaining ?? 0;
  return (
    <Link
      href="/account"
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${left > 0 ? "bg-marker-soft text-marker ring-marker/10" : "bg-amber-soft text-amber ring-amber/10"} hover:brightness-[.98]`}
    >
      Free plan: {left === 1 ? "1 search left" : `${left} searches left`}
      <span className="ml-1.5 hidden underline underline-offset-2 sm:inline">Upgrade</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Shell>{children}</Shell>
    </RequireAuth>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { company } = useData();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="app-backdrop min-h-dvh pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-marker text-marker-ink">
              <Search size={16} strokeWidth={2.25} />
            </span>
            Scout
          </Link>
          {company && <span className="hidden text-sm text-muted sm:inline">for {company}</span>}
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active(n.href) ? "bg-marker-soft text-marker" : "text-muted hover:bg-black/[.03] hover:text-ink"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <PlanBadge />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-[1120px] px-4 pb-10 pt-6 sm:px-6 md:px-8 md:pt-10">{children}</main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-surface shadow-[0_-4px_16px_-12px_rgba(23,23,23,.12)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${active(n.href) ? "text-marker" : "text-muted"}`}
            >
              <Icon size={20} />
              {n.short ?? n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
