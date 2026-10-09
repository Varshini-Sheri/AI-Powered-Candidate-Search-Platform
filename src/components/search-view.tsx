"use client";
import { RotateCcw, Search as SearchIcon, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card, Filters, SearchResult } from "@/lib/types";
import { ApiError, api } from "./api";
import { CandidateRow } from "./candidate-row";
import { useAuth } from "./auth";
import { useData } from "./data";
import { FilterChips, useDraftFilters } from "./filter-chips";
import { ShortlistButton } from "./shortlist-button";
import { useToast } from "./toast";
import { Notice, Sheet, SkeletonRows, btn } from "./ui";

interface Current {
  id: string;
  brief: string;
  filters: Filters;
  total: number;
  results: Card[];
  page: number;
  reason: string | null;
}

type Phase = "idle" | "searching" | "refining" | "paging" | "restoring";
interface Problem { title: string; message: string; retry?: () => void; upgrade?: boolean; undo?: boolean }

const EXAMPLE = "Senior React engineers in New York who have worked at a startup";

export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const sParam = params.get("s");
  const { plan, refreshPlan } = useData();
  const toast = useToast();

  const [brief, setBrief] = useState("");
  const [current, setCurrent] = useState<Current | null>(null);
  const [phase, setPhase] = useState<Phase>(sParam ? "restoring" : "idle");
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  // A new brief that needs a search the company doesn't have: shown as an in-page upgrade card.
  const [blockedBrief, setBlockedBrief] = useState<string | null>(null);
  // The saved search for the results on screen, if they've been saved.
  const [savedId, setSavedId] = useState<string | null>(null);
  const { draft, setDraft, dirty, reset } = useDraftFilters(current?.filters ?? null);
  // Switching tabs and coming back returns to the search you were viewing. It is
  // remembered for this visit only: signing out or a new visit starts blank.
  const { session } = useAuth();
  const memoryKey = session ? `scout:viewing:${session.user.id}` : null;
  const [checkedLatest, setCheckedLatest] = useState(!!sParam);
  const resultsRef = useRef<HTMLDivElement>(null);

  const free = plan?.plan === "free";
  const exhausted = free && (plan?.searches_remaining ?? 0) <= 0;
  const busy = phase === "searching" || phase === "refining";

  // Two-step loading copy, so a 2 second wait reads as progress.
  useEffect(() => {
    if (phase !== "searching") return setStep(0);
    const t = setTimeout(() => setStep(1), 900);
    return () => clearTimeout(t);
  }, [phase]);

  const show = useCallback(
    (r: SearchResult, b: string) => {
      setCurrent({ id: r.search_id, brief: b, filters: r.filters, total: r.total, results: r.results, page: 1, reason: r.reason ?? null });
      if (sParam !== r.search_id) router.replace(`/?s=${r.search_id}`, { scroll: false });
    },
    [router, sParam],
  );

  useEffect(() => {
    if (sParam || checkedLatest || !memoryKey) return;
    let remembered: string | null = null;
    try {
      remembered = sessionStorage.getItem(memoryKey);
    } catch {}
    if (remembered) router.replace(`/?s=${remembered}`, { scroll: false });
    setCheckedLatest(true);
  }, [sParam, checkedLatest, memoryKey, router]);

  useEffect(() => {
    if (!current?.id || !memoryKey) return;
    try {
      sessionStorage.setItem(memoryKey, current.id);
    } catch {}
  }, [current?.id, memoryKey]);

  // Restore a search from the URL (refresh, back button, saved search run).
  useEffect(() => {
    if (!sParam || current?.id === sParam) return;
    setPhase("restoring");
    api<SearchResult & { brief: string }>(`/api/search/${sParam}?page=1`)
      .then((r) => {
        setBrief(r.brief);
        setCurrent({ id: r.search_id, brief: r.brief, filters: r.filters, total: r.total, results: r.results, page: 1, reason: null });
      })
      .catch(() => router.replace("/", { scroll: false }))
      .finally(() => setPhase("idle"));
  }, [sParam, current?.id, router]);

  async function runSearch() {
    const b = brief.trim();
    if (b.length < 3 || busy) return;
    if (exhausted) {
      // The server would answer 402; ask to upgrade straight away and keep the brief.
      setProblem(null);
      setBlockedBrief(b);
      return;
    }
    setBlockedBrief(null);
    setProblem(null);
    setPhase("searching");
    try {
      const r = await api<SearchResult>("/api/search", { method: "POST", body: { brief: b } });
      show(r, b);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setBlockedBrief(b);
      else handleError(e, runSearch);
    } finally {
      setPhase("idle");
      refreshPlan().catch(() => {});
    }
  }

  async function applyFilters() {
    if (!current || !draft || busy) return;
    setProblem(null);
    setPhase("refining");
    try {
      const r = await api<SearchResult>(`/api/search/${current.id}/refine`, { method: "POST", body: { filters: draft } });
      show(r, current.brief);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setProblem({
          title: "These filters would bring in new people.",
          message: "That needs a search, and you've used your free one.",
          upgrade: true,
          undo: true,
        });
      } else if (e instanceof ApiError && e.code === "no_required") {
        setProblem({ title: "Keep at least one must-have filter", message: "Without one, the search would match everyone." });
      } else handleError(e, applyFilters);
    } finally {
      setPhase("idle");
      refreshPlan().catch(() => {});
    }
  }

  async function loadMore() {
    if (!current || phase !== "idle") return;
    setPhase("paging");
    try {
      const r = await api<SearchResult>(`/api/search/${current.id}?page=${current.page + 1}`);
      setCurrent({ ...current, results: [...current.results, ...r.results], page: current.page + 1 });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't load more results.");
    } finally {
      setPhase("idle");
    }
  }

  function backToResults() {
    setBlockedBrief(null);
    if (current) setBrief(current.brief);
  }

  // Is the search on screen already saved? Then the star shows as saved.
  useEffect(() => {
    setSavedId(null);
    if (!current?.id) return;
    api<Array<{ id: string; search_id: string | null }>>("/api/saved-briefs")
      .then((list) => setSavedId(list.find((s) => s.search_id === current.id)?.id ?? null))
      .catch(() => {});
  }, [current?.id]);

  async function toggleSaved() {
    if (!current) return;
    setSaving(true);
    try {
      if (savedId) {
        await api(`/api/saved-briefs/${savedId}`, { method: "DELETE" });
        setSavedId(null);
        toast("Removed from saved searches");
      } else {
        const r = await api<{ id: string }>("/api/saved-briefs", { method: "POST", body: { brief: current.brief, filters: current.filters, search_id: current.id } });
        setSavedId(r.id);
        toast("Search saved", { label: "View saved searches", href: "/saved" });
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't update saved searches.");
    } finally {
      setSaving(false);
    }
  }

  function handleError(e: unknown, retry: () => void) {
    if (e instanceof ApiError && e.status === 400) {
      setProblem({ title: "Check your brief", message: e.message });
    } else {
      setProblem({ title: "The search didn't finish", message: e instanceof ApiError ? e.message : "Something went wrong.", retry });
    }
  }

  const highlight = useMemo(
    () => (current?.filters.constraints ?? []).filter((c) => c.field === "skill" && c.mode !== "excluded").flatMap((c) => c.labels),
    [current?.filters],
  );
  const hlParam = highlight.length ? `?hl=${encodeURIComponent(highlight.join(","))}` : "";
  const canSearch = brief.trim().length >= 3 && !busy;

  // Before the first search, the brief sits a little above the middle of the page.
  const landing = !current && phase === "idle" && !problem && checkedLatest;

  return (
    <div className={`mx-auto max-w-[800px] ${landing ? "md:flex md:min-h-[calc(100dvh-10rem)] md:flex-col md:justify-center md:pb-[12vh]" : ""}`}>
      {/* Brief */}
      {!checkedLatest && !current ? null : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <label htmlFor="brief" className="mb-4 block text-[22px] font-semibold tracking-[-0.02em] md:mb-4 md:text-[26px]">
            Who are you looking for?
          </label>
          <div className="rounded-2xl border border-line-strong bg-surface shadow-[0_1px_2px_rgba(23,23,23,.04),0_8px_24px_-12px_rgba(114,92,242,.18)] transition-shadow focus-within:border-marker/60 focus-within:ring-[3px] focus-within:ring-marker/12">
            <textarea
              id="brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runSearch();
                }
              }}
              rows={2}
              maxLength={500}
              placeholder={EXAMPLE}
              className="block w-full resize-none rounded-2xl bg-transparent px-4 pb-0.5 pt-3 text-base leading-normal placeholder:text-faint sm:px-5 sm:pt-3.5 focus:outline-none focus-visible:outline-none md:text-[17px]"
            />
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 px-3 pb-2.5 sm:px-3.5">
              {exhausted ? (
                <p className="mr-auto pl-1 text-sm text-amber">
                  Free search used.{" "}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => setBlockedBrief(brief.trim() || current?.brief || "")}
                  >
                    Upgrade to search again
                  </button>
                </p>
              ) : (
                free && <p className="mr-auto pl-1 text-sm text-muted">This uses your free search.</p>
              )}
              <button type="submit" className={`${btn.primary} max-sm:w-full`} disabled={!canSearch}>
                <SearchIcon size={16} /> {phase === "searching" ? "Searching…" : "Search"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* What we understood */}
      {current && draft && phase !== "searching" && !blockedBrief && (
        <section className="mt-8 md:mt-6" aria-labelledby="understood-h">
          <h2 id="understood-h" className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-faint">
            Searching for
          </h2>
          <FilterChips filters={draft} onChange={setDraft} disabled={busy} />
          <p className="mt-2.5 text-xs text-faint">Click a filter to change it, or × to remove it.</p>
          {dirty && !problem?.undo && (
            <div className="anim-fade mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-marker-soft px-4 py-1.5">
              <p className="mr-auto text-sm text-ink">Filters changed.</p>
              <button className={btn.ghost} onClick={reset} disabled={busy}>
                <RotateCcw size={15} /> Undo
              </button>
              <button className={`${btn.primary} h-9`} onClick={applyFilters} disabled={busy}>
                {phase === "refining" ? "Updating…" : "Update results"}
              </button>
            </div>
          )}
        </section>
      )}

      {problem && (
        <div className="mt-6 md:mt-5">
          <Notice
            tone={problem.upgrade ? "amber" : "stop"}
            title={problem.title}
            action={
              problem.upgrade ? (
                <div className="flex flex-wrap gap-2">
                  <Link href="/account" className={btn.primary}>Upgrade</Link>
                  {problem.undo && (
                    <button className={btn.secondary} onClick={() => { reset(); setProblem(null); }}>
                      Undo changes
                    </button>
                  )}
                </div>
              ) : problem.retry ? (
                <button className={btn.secondary} onClick={problem.retry}>Try again</button>
              ) : undefined
            }
          >
            {problem.message}
          </Notice>
        </div>
      )}

      {/* Results */}
      <div ref={resultsRef} className="mt-10 md:mt-8" aria-live="polite" aria-busy={busy || phase === "restoring"}>
        {phase === "searching" || phase === "restoring" || (!checkedLatest && !current) ? (
          <div>
            <p className="mb-2 text-sm text-muted">{phase !== "searching" ? "Loading your search…" : step === 0 ? "Reading your brief…" : "Finding candidates…"}</p>
            <SkeletonRows />
          </div>
        ) : blockedBrief ? null : current ? (
          <Results
            current={current}
            refining={phase === "refining"}
            paging={phase === "paging"}
            hlParam={hlParam}
            highlight={highlight}
            onMore={loadMore}
            onSave={toggleSaved}
            saving={saving}
            saved={!!savedId}
            freeSearch={free}
          />
        ) : (
          !exhausted && (
            <p className="text-sm leading-relaxed text-muted">
              Describe who you're hiring, the way you'd tell a colleague.
            </p>
          )
        )}
      </div>

      {/* Free search used: the results step aside and the upgrade prompt opens. */}
      <Sheet
        open={blockedBrief !== null}
        onOpenChange={(o) => {
          if (!o) backToResults();
        }}
        title="Upgrade to run this search"
      >
        <div className="space-y-4 text-[15px] leading-relaxed">
          <p className="text-muted">You've used your free search. The paid plan gives everyone at your company unlimited searches.</p>
          <p className="text-muted">Your brief is kept, and your results, shortlists and saved searches stay as they are.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/account" className={btn.primary}>
              Upgrade
            </Link>
            <button className={btn.secondary} onClick={backToResults}>
              {current ? "Back to my results" : "Not now"}
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Results({
  current, refining, paging, hlParam, highlight, onMore, onSave, saving, saved, freeSearch,
}: {
  current: Current; refining: boolean; paging: boolean; hlParam: string; highlight: string[];
  onMore: () => void; onSave: () => void; saving: boolean; saved: boolean; freeSearch: boolean;
}) {
  const blocking = current.filters.unsupported.filter((u) => u.mode !== "preferred");

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        <span className="font-semibold">{current.total.toLocaleString()}</span>{" "}
        {current.total === 1 ? "person" : "people"}
        {current.total > 1 && <span className="text-muted">, best matches first</span>}
      </p>
      <button
        className={btn.secondary}
        onClick={onSave}
        disabled={saving}
        aria-pressed={saved}
        title={saved ? "Remove from saved searches" : "Save this search"}
      >
        <Star size={16} className={saved ? "fill-[#f5b301] text-[#d99a00]" : ""} /> {saved ? "Saved" : "Save search"}
      </button>
      {freeSearch && !saved && current.total > 0 && (
        <p className="w-full text-[13px] text-muted">This is your free search. Save it to come back to these results later.</p>
      )}
    </div>
  );

  if (current.total === 0) {
    let notice;
    if (current.reason === "unsupported" || blocking.length) {
      notice = (
        <Notice tone="amber" title="We can't check everything you asked for">
          Our candidate data doesn't include {blocking.map((u) => u.text).join(", ") || "part of this brief"}, so we can't promise anyone matches. Mark it nice to have or remove it above to see who fits the rest.
        </Notice>
      );
    } else if (current.reason === "no_required") {
      notice = (
        <Notice title="Add something concrete to search on">
          Try a role, skill, location or company, for example "{EXAMPLE.toLowerCase()}". That search wasn't counted.
        </Notice>
      );
    } else if (current.reason === "too_broad") {
      notice = <Notice title="That matches everyone">Add a role, skill or location to narrow it down.</Notice>;
    } else {
      notice = (
        <Notice title="No one matches all of these">
          Remove a filter or mark one nice to have to widen the search.
        </Notice>
      );
    }
    return (
      <div className={refining ? "opacity-50" : ""}>
        {header}
        <div>{notice}</div>
      </div>
    );
  }

  return (
    <div className={refining ? "pointer-events-none opacity-50 transition-opacity" : ""}>
      {header}
      <ul className="flex flex-col gap-2.5 sm:gap-3">
        {current.results.map((c) => (
          <CandidateRow key={c.id} c={c} highlight={highlight} href={`/people/${encodeURIComponent(c.id)}${hlParam}`} action={<ShortlistButton personId={c.id} name={c.name} />} />
        ))}
      </ul>
      <div className="mt-6 flex flex-col items-center gap-3 pb-8">
        <p className="text-sm text-muted">
          Showing {current.results.length.toLocaleString()} of {current.total.toLocaleString()}
        </p>
        {current.results.length < current.total && (
          <button className={btn.secondary} onClick={onMore} disabled={paging}>
            {paging ? "Loading…" : "Show 20 more"}
          </button>
        )}
      </div>
    </div>
  );
}
