"use client";
import * as Popover from "@radix-ui/react-popover";
import { Bookmark, BookmarkCheck, Check, Plus } from "lucide-react";
import { useState } from "react";
import { ApiError } from "./api";
import { useData } from "./data";
import { useToast } from "./toast";
import { btn, input } from "./ui";

/** "Shortlist" button: tick the lists a candidate belongs to, or start a new one. */
export function ShortlistButton({ personId, name, compact = false }: { personId: string; name: string; compact?: boolean }) {
  const { lists, setMembership, createList } = useData();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inLists = (lists ?? []).filter((l) => l.person_ids.includes(personId));
  const saved = inLists.length > 0;

  async function toggle(listId: string, listName: string, on: boolean) {
    setError(null);
    try {
      await setMembership(listId, personId, on);
      toast(on ? `Added ${name} to ${listName}` : `Removed ${name} from ${listName}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update the list.");
    }
  }

  async function create() {
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createList(n);
      await setMembership(id, personId, true);
      toast(`Added ${name} to ${n}`, { label: "View list", href: `/shortlists?list=${id}` });
      setNewName("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the list.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={`${saved ? "border-marker/40 bg-marker-soft text-marker" : "border-line-strong bg-surface text-ink hover:bg-paper"} inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium`}
          aria-label={saved ? `${name} is shortlisted. Change lists` : `Shortlist ${name}`}
        >
          {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          <span className={compact ? "sr-only sm:not-sr-only" : ""}>{saved ? "Shortlisted" : "Shortlist"}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onClick={(e) => e.stopPropagation()}
          className="anim-fade z-50 max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-xl"
        >
          <p className="px-2 pb-1 pt-1 text-sm font-medium">Add {name.split(" ")[0]} to</p>
          {lists === null ? (
            <p className="px-2 py-2 text-sm text-muted">Loading lists…</p>
          ) : lists.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted">No lists yet. Name your first one below.</p>
          ) : (
            <ul className="max-h-60 overflow-y-auto py-1">
              {lists.map((l) => {
                const on = l.person_ids.includes(personId);
                return (
                  <li key={l.id}>
                    <button
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => toggle(l.id, l.name, !on)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-paper"
                    >
                      <span className={`flex h-4.5 w-4.5 items-center justify-center rounded border ${on ? "border-marker bg-marker text-white" : "border-line-strong"}`}>
                        {on && <Check size={12} strokeWidth={3} />}
                      </span>
                      <span className="flex-1 truncate">{l.name}</span>
                      <span className="text-xs text-faint">{l.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="mt-1 flex gap-2 border-t border-line px-1 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input className={`${input} h-9 text-sm`} placeholder="New list name" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} aria-label="New list name" />
            <button type="submit" className={`${btn.secondary} h-9 shrink-0 px-2.5`} disabled={busy || !newName.trim()} aria-label="Create list and add">
              <Plus size={16} />
            </button>
          </form>
          {error && <p className="px-2 pt-2 text-sm text-stop">{error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
