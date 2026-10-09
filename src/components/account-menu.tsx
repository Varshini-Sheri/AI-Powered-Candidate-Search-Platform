"use client";
import * as Popover from "@radix-ui/react-popover";
import { CreditCard, LogOut } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "./auth";
import { useData } from "./data";

/** Avatar button in the header: who you are, plan & billing, sign out. */
export function AccountMenu() {
  const { session, signOut } = useAuth();
  const { company, plan } = useData();
  const [open, setOpen] = useState(false);
  const email = session?.user.email ?? "";
  const initial = (email[0] ?? "?").toUpperCase();
  const planText = !plan ? "" : plan.plan === "paid" ? "Paid plan" : `Free plan, ${plan.searches_remaining ?? 0} search${plan.searches_remaining === 1 ? "" : "es"} left`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-medium text-white hover:opacity-90"
      >
        {initial}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={12} className="anim-fade z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          <div className="px-3 pb-2 pt-2">
            <p className="truncate text-sm font-medium">{email}</p>
            <p className="mt-0.5 text-[13px] text-muted">
              {company ?? ""}
              {company && planText ? ", " : ""}
              {planText}
            </p>
          </div>
          <div className="my-1 border-t border-line" />
          <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-paper">
            <CreditCard size={16} className="text-muted" /> Plan & billing
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"
          >
            <LogOut size={16} className="text-muted" /> Sign out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
