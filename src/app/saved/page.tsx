"use client";
import { Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { chipText } from "@/components/filter-chips";
import { useData } from "@/components/data";
import { UpgradeDialog } from "@/components/upgrade";
import { useToast } from "@/components/toast";
import { Notice, btn } from "@/components/ui";
import type { Constraint, SavedBrief, SearchResult } from "@/lib/types";

function Saved() {
  const router = useRouter();
  const toast = useToast();
  const { plan, refreshPlan } = useData();
  const [items, setItems] = useState<SavedBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [paywall, setPaywall] = useState(false);
  const exhausted = plan?.plan === "free" && (plan.searches_remaining ?? 0) <= 0;

  const load = useCallback(() => {
    setError(null);
    api<SavedBrief[]>("/api/saved-briefs").then(setItems).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load saved searches."));
  }, []);
  useEffect(load, [load]);

  async function run(s: SavedBrief) {
    setRunning(s.id);
    try {
      const r = await api<SearchResult>(`/api/saved-briefs/${s.id}/run`, { method: "POST" });
      await refreshPlan().catch(() => {});
      router.push(`/?s=${r.search_id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setPaywall(true);
      else toast(e instanceof ApiError ? e.message : "Couldn't run the search.");
      setRunning(null);
    }
  }

  async function remove(s: SavedBrief) {
    setItems((i) => i?.filter((x) => x.id !== s.id) ?? null);
    try {
      await api(`/api/saved-briefs/${s.id}`, { method: "DELETE" });
      toast("Saved search deleted");
    } catch {
      load();
    }
  }

  return (
    <div className="mx-auto max-w-[800px]">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] md:text-[26px]">Saved searches</h1>
      <div className="mt-6">
        {error ? (
          <Notice tone="stop" title="Saved searches didn't load" action={<button className={btn.secondary} onClick={load}>Try again</button>}>{error}</Notice>
        ) : items === null ? (
          <div className="space-y-3">
            <span className="skeleton block h-24 rounded-2xl" />
            <span className="skeleton block h-24 rounded-2xl" />
          </div>
        ) : items.length === 0 ? (
          <Notice title="No saved searches yet" action={<Link href="/" className={btn.secondary}>Start a search</Link>}>
            After a search, use Save search to keep it here and come back to it later.
          </Notice>
        ) : (
          <ul className="space-y-3">
            {items.map((s) => {
              const cons = (s.filters.constraints ?? []) as Constraint[];
              const savedOn = new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const total = s.searches?.total;
              return (
                <li key={s.id} className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:gap-6 sm:p-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold leading-snug text-ink">{s.brief}</p>
                    {cons.length > 0 && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">
                        {cons.map((c) => `${c.mode === "excluded" ? "not " : ""}${chipText(c)}${c.mode === "preferred" ? " (nice to have)" : ""}`).join(" · ")}
                      </p>
                    )}
                    <p className="mt-3 text-xs font-medium text-faint">Saved {savedOn}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-start gap-2 border-t border-line pt-4 sm:border-0 sm:pt-0">
                    {s.search_id && (
                      <div className="flex flex-col items-center">
                        <Link href={`/?s=${s.search_id}`} className={btn.secondary} title="Open the results you saved. Free, and the same people as before.">
                          View results
                        </Link>
                        <span className="mt-1 text-[11px] text-faint">
                          {typeof total === "number" ? `${total.toLocaleString()} from ${savedOn}` : `From ${savedOn}`}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col items-center">
                      <button
                        className={btn.primary}
                        onClick={() => (exhausted ? setPaywall(true) : run(s))}
                        disabled={running !== null}
                        title="Run this search again on today's candidates. New people may appear."
                      >
                        <Search size={15} /> {running === s.id ? "Searching…" : "Find new matches"}
                      </button>
                      <span className="mt-1 text-[11px] text-faint">
                        {plan?.plan === "free" && !exhausted ? "Uses your free search" : "Searches today's candidates"}
                      </span>
                    </div>
                    <button className={`${btn.ghost} h-10 w-10 px-0 hover:text-stop`} onClick={() => remove(s)} aria-label={`Delete saved search ${s.brief}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <UpgradeDialog open={paywall} onOpenChange={setPaywall} paywall />
    </div>
  );
}

export default function SavedPage() {
  return (
    <AppShell>
      <Saved />
    </AppShell>
  );
}
