"use client";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { CandidateRow } from "@/components/candidate-row";
import { useData } from "@/components/data";
import { useToast } from "@/components/toast";
import { Notice, Sheet, SkeletonRows, btn, input } from "@/components/ui";
import type { Card } from "@/lib/types";

function Shortlists() {
  const { lists, refreshLists, createList, setMembership } = useData();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  // While a profile is open over this page, the address is /people/…, which has no
  // ?list=. Keep showing the list that was open instead of reacting to that address.
  const onThisPage = usePathname() === "/shortlists";
  const [selectedId, setSelectedId] = useState<string | null>(params.get("list"));
  useEffect(() => {
    if (onThisPage) setSelectedId(params.get("list"));
  }, [onThisPage, params]);
  const selected = lists?.find((l) => l.id === selectedId) ?? null;

  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [people, setPeople] = useState<Card[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const select = (id: string | null) => router.replace(id ? `/shortlists?list=${id}` : "/shortlists", { scroll: false });

  // On wide screens, open the first list by default.
  useEffect(() => {
    if (!onThisPage) return;
    if (!params.get("list") && lists?.length && window.matchMedia("(min-width: 768px)").matches) select(lists[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, params, onThisPage]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setPeople(null);
    setLoadError(null);
    try {
      const r = await api<{ people: Card[] }>(`/api/shortlists/${selectedId}`);
      setPeople(r.people);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load this list.");
    }
  }, [selectedId]);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreateError(null);
    try {
      const id = await createList(name.trim());
      setName("");
      select(id);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Couldn't create the list.");
    }
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !rename.trim()) return;
    try {
      await api(`/api/shortlists/${selected.id}`, { method: "PATCH", body: { name: rename.trim() } });
      await refreshLists();
      setRenaming(false);
      toast("List renamed");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't rename the list.");
    }
  }

  async function remove() {
    if (!selected) return;
    try {
      await api(`/api/shortlists/${selected.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      select(null);
      await refreshLists();
      toast(`Deleted ${selected.name}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't delete the list.");
    }
  }

  async function removePerson(c: Card) {
    if (!selected) return;
    setPeople((p) => p?.filter((x) => x.id !== c.id) ?? null);
    try {
      await setMembership(selected.id, c.id, false);
      toast(`Removed ${c.name}`);
    } catch {
      load();
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-[260px_minmax(0,1fr)]">
      {/* Lists */}
      <aside className={`min-w-0 ${selectedId ? "hidden md:block" : ""}`}>
        <h1 className="mb-5 text-[22px] font-semibold tracking-[-0.02em] md:text-[26px]">Shortlists</h1>
        <form onSubmit={create} className="flex gap-2">
          <input className={input} placeholder="New list name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="New list name" />
          <button type="submit" className={`${btn.secondary} shrink-0 px-3`} disabled={!name.trim()} aria-label="Create list">
            <Plus size={16} /> <span className="md:hidden">Create</span>
          </button>
        </form>
        {createError && <p className="mt-2 text-sm text-stop">{createError}</p>}
        {lists === null ? (
          <div className="mt-4 space-y-2">
            <span className="skeleton block h-10 rounded-lg" />
            <span className="skeleton block h-10 rounded-lg" />
          </div>
        ) : lists.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-muted">
            No lists yet. Create one here, or use Shortlist on any search result.
          </p>
        ) : (
          <ul className="mt-4 space-y-0.5">
            {lists.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => select(l.id)}
                  aria-current={l.id === selectedId ? "true" : undefined}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[15px] transition-colors ${l.id === selectedId ? "bg-marker-soft font-medium" : "hover:bg-black/[.03]"}`}
                >
                  <span className="truncate">{l.name}</span>
                  <span className="ml-3 text-sm text-faint">{l.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Members */}
      <section className={`min-w-0 ${selectedId ? "" : "hidden md:block"}`}>
        {!selected ? (
          lists && lists.length > 0 && <p className="pt-12 text-sm text-muted">Choose a list to see who's on it.</p>
        ) : (
          <>
            <button className={`${btn.ghost} -ml-2.5 mb-2 md:hidden`} onClick={() => select(null)}>
              <ArrowLeft size={16} /> All lists
            </button>
            <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
              {renaming ? (
                <form onSubmit={saveRename} className="flex flex-1 gap-2">
                  <input className={input} value={rename} maxLength={80} autoFocus onChange={(e) => setRename(e.target.value)} aria-label="List name" />
                  <button className={`${btn.primary} shrink-0`} type="submit" disabled={!rename.trim()}>Save</button>
                  <button className={`${btn.ghost} shrink-0`} type="button" onClick={() => setRenaming(false)}>Cancel</button>
                </form>
              ) : (
                <>
                  <h2 className="mr-auto text-lg font-semibold">{selected.name}</h2>
                  <button className={btn.ghost} onClick={() => { setRename(selected.name); setRenaming(true); }}>
                    <Pencil size={15} /> Rename
                  </button>
                  <button className={`${btn.ghost} hover:text-stop`} onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={15} /> Delete
                  </button>
                </>
              )}
            </div>
            {loadError ? (
              <div className="mt-4"><Notice tone="stop" title="This list didn't load" action={<button className={btn.secondary} onClick={load}>Try again</button>}>{loadError}</Notice></div>
            ) : people === null ? (
              <SkeletonRows n={3} />
            ) : people.length === 0 ? (
              <div className="mt-4">
                <Notice title="No one on this list yet" action={<Link href="/" className={btn.secondary}>Search candidates</Link>}>
                  Use Shortlist on a search result or profile to add people here.
                </Notice>
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2.5 sm:gap-3">
                {people.map((c) => (
                  <CandidateRow
                    key={c.id}
                    c={c}
                    href={`/people/${encodeURIComponent(c.id)}`}
                    action={<button className={btn.ghost} onClick={() => removePerson(c)} aria-label={`Remove ${c.name} from ${selected.name}`}>Remove</button>}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <Sheet open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${selected?.name ?? "list"}?`} description="The list goes away for everyone at your company. The candidates stay in search.">
        <div className="flex justify-end gap-2 pt-2">
          <button className={btn.secondary} onClick={() => setConfirmDelete(false)}>Keep list</button>
          <button className={btn.danger} onClick={remove}>Delete list</button>
        </div>
      </Sheet>
    </div>
  );
}

export default function ShortlistsPage() {
  return (
    <AppShell>
      <Suspense>
        <Shortlists />
      </Suspense>
    </AppShell>
  );
}
