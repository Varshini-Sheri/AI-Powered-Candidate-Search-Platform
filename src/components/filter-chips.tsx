"use client";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Constraint, Field, Filters, Mode, Unsupported } from "@/lib/types";
import { api } from "./api";
import { btn, input } from "./ui";

// The filters the app understood, read back as a row of chips. Each mode has
// its own look: solid for must-have, dashed for nice-to-have, red for excluded,
// amber for something the data can't check.

const FIELD_LABEL: Record<Field, string> = {
  role: "Role",
  title: "Job title",
  seniority: "Seniority",
  years: "Years of experience",
  skill: "Skill",
  location: "Location",
  company: "Company",
  company_trait: "Company type",
  education_level: "Degree",
  school: "School",
  field_of_study: "Field of study",
  open_to_work: "Open to work",
};
const ADDABLE: Field[] = ["skill", "role", "seniority", "years", "location", "company", "title", "company_trait", "open_to_work", "education_level", "school", "field_of_study"];
const ENUM_FIELDS: Field[] = ["role", "seniority", "education_level"];
const SCOPED: Field[] = ["role", "title", "company", "company_trait"];
const MODE_LABEL: Record<Mode, string> = { required: "Must have", preferred: "Nice to have", excluded: "Exclude" };

export function chipText(c: Constraint): string {
  const vals = c.labels.join(" or ");
  const current = c.scope === "current";
  const not = c.mode === "excluded";
  switch (c.field) {
    case "years":
      return c.labels[0] ?? "Years";
    case "open_to_work":
      return not ? "open to work" : "Open to work";
    case "company":
      return current ? `${not ? "currently" : "Currently"} at ${vals}` : not ? vals : `Worked at ${vals}`;
    case "company_trait":
      return current ? `${not ? "currently" : "Currently"} at a ${vals.toLowerCase()} company` : `${not ? "" : ""}${vals} experience`;
    case "location":
      return `${not ? "in" : "In"} ${vals}`;
    case "school":
      return `${not ? "studied" : "Studied"} at ${vals}`;
    case "field_of_study":
      return `${not ? "studied" : "Studied"} ${vals}`;
    case "title":
      return current ? `${not ? "current" : "Current"} title ${vals}` : vals;
    case "role":
      return current ? `${vals}, current role` : vals;
    default:
      return vals;
  }
}

function sameFilters(a: Filters, b: Filters): boolean {
  const norm = (f: Filters) =>
    JSON.stringify({
      c: f.constraints.map((c) => [c.field, c.mode, c.scope ?? null, c.values, c.min ?? null, c.max ?? null]),
      u: f.unsupported.map((u) => [u.text, u.mode]),
    });
  return norm(a) === norm(b);
}

export function useDraftFilters(source: Filters | null) {
  const [draft, setDraft] = useState<Filters | null>(source);
  useEffect(() => setDraft(source), [source]);
  const dirty = !!source && !!draft && !sameFilters(source, draft);
  return { draft, setDraft, dirty, reset: () => setDraft(source) };
}

export function FilterChips({ filters, onChange, disabled }: { filters: Filters; onChange: (f: Filters) => void; disabled?: boolean }) {
  const setConstraint = (id: string, next: Constraint | null) =>
    onChange({ ...filters, constraints: next ? filters.constraints.map((c) => (c.id === id ? next : c)) : filters.constraints.filter((c) => c.id !== id) });
  const setUnsupported = (i: number, next: Unsupported | null) =>
    onChange({ ...filters, unsupported: next ? filters.unsupported.map((u, j) => (j === i ? next : u)) : filters.unsupported.filter((_, j) => j !== i) });

  const order: Mode[] = ["required", "preferred", "excluded"];
  const sorted = [...filters.constraints].sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode));

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Filters the search understood">
      {sorted.map((c) => (
        <ConstraintChip key={c.id} c={c} disabled={disabled} onChange={(n) => setConstraint(c.id, n)} />
      ))}
      {filters.unsupported.map((u, i) => (
        <UnsupportedChip key={`${u.text}-${i}`} u={u} disabled={disabled} onChange={(n) => setUnsupported(i, n)} />
      ))}
      <AddFilter
        disabled={disabled}
        onAdd={(c) => onChange({ ...filters, constraints: [...filters.constraints, c] })}
        nextId={`n${Date.now()}`}
      />
    </div>
  );
}

function chipClass(mode: Mode): string {
  switch (mode) {
    case "required":
      return "border-marker/15 bg-marker-soft/70 text-[#4d3bc4]";
    case "preferred":
      return "border-dashed border-line-strong bg-surface text-muted";
    case "excluded":
      return "border-[#e6b7b1] bg-stop-soft text-stop";
  }
}

function ChipShell({ className, children, onRemove, removeLabel, disabled }: { className: string; children: ReactNode; onRemove: () => void; removeLabel: string; disabled?: boolean }) {
  return (
    <span className={`inline-flex h-8 items-center rounded-full border text-[13px] ${className}`}>
      {children}
      <button disabled={disabled} onClick={onRemove} aria-label={removeLabel} className="mr-1 flex h-6 w-6 items-center justify-center rounded-full opacity-50 transition-opacity hover:bg-black/[.05] hover:opacity-100">
        <X size={14} />
      </button>
    </span>
  );
}

function ConstraintChip({ c, onChange, disabled }: { c: Constraint; onChange: (c: Constraint | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const text = chipText(c);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <ChipShell className={chipClass(c.mode)} onRemove={() => onChange(null)} removeLabel={`Remove filter ${text}`} disabled={disabled}>
        <Popover.Trigger asChild disabled={disabled}>
          <button className="flex h-full items-center gap-2 pl-3.5 pr-1.5 font-medium" aria-label={`Edit filter ${text}`}>
            {c.mode === "excluded" && <span>Not</span>}
            <span className={c.mode === "preferred" ? "font-normal" : ""}>{text}</span>
            {c.mode === "preferred" && <span className="text-xs text-faint">nice to have</span>}
            <ChevronDown size={14} className="opacity-50" aria-hidden />
          </button>
        </Popover.Trigger>
      </ChipShell>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="anim-fade z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-[0_12px_32px_-12px_rgba(23,23,23,.2)]">
          <ConstraintEditor
            initial={c}
            onCancel={() => setOpen(false)}
            onSave={(n) => {
              onChange(n);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UnsupportedChip({ u, onChange, disabled }: { u: Unsupported; onChange: (u: Unsupported | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const blocking = u.mode !== "preferred";
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <ChipShell className="border-[#ecd29c] bg-amber-soft text-amber" onRemove={() => onChange(null)} removeLabel={`Remove ${u.text}`} disabled={disabled}>
        <Popover.Trigger asChild disabled={disabled}>
          <button className="flex h-full items-center gap-2 pl-3.5 pr-1.5 font-medium" aria-label={`About ${u.text}`}>
            <AlertTriangle size={14} />
            <span>{blocking ? "Can't filter by" : "Skipped"}: {u.text}</span>
          </button>
        </Popover.Trigger>
      </ChipShell>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="anim-fade z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-sm shadow-[0_12px_32px_-12px_rgba(23,23,23,.2)]">
          <p className="font-medium">Our candidate data doesn't include this</p>
          <p className="mt-1 text-muted">
            {blocking
              ? "Because you asked for it, we can't promise anyone matches, so the search returns nobody. Remove it or mark it nice to have to see everyone else who fits."
              : "It's marked nice to have, so the search ignores it and shows everyone who fits the rest."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {blocking ? (
              <button className={btn.secondary} onClick={() => { onChange({ ...u, mode: "preferred" }); setOpen(false); }}>
                Make it nice to have
              </button>
            ) : (
              <button className={btn.secondary} onClick={() => { onChange({ ...u, mode: "required" }); setOpen(false); }}>
                Make it a must-have
              </button>
            )}
            <button className={btn.ghost} onClick={() => { onChange(null); setOpen(false); }}>
              Remove
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AddFilter({ onAdd, disabled, nextId }: { onAdd: (c: Constraint) => void; disabled?: boolean; nextId: string }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field | null>(null);
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setField(null); }}>
      <Popover.Trigger asChild disabled={disabled}>
        <button className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-marker hover:bg-marker-soft">
          <Plus size={15} /> Add filter
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="anim-fade z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-[0_12px_32px_-12px_rgba(23,23,23,.2)]">
          {!field ? (
            <div>
              <p className="mb-2 text-sm font-medium">Filter by</p>
              <div className="grid grid-cols-2 gap-1">
                {ADDABLE.map((f) => (
                  <button key={f} onClick={() => setField(f)} className="rounded-lg px-2.5 py-2 text-left text-sm hover:bg-paper">
                    {FIELD_LABEL[f]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ConstraintEditor
              initial={{ id: nextId, field, mode: "required", values: [], labels: [], ...(SCOPED.includes(field) ? { scope: "any" as const } : {}) }}
              onCancel={() => setField(null)}
              onSave={(c) => {
                onAdd(c);
                setOpen(false);
                setField(null);
              }}
              isNew
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface Option { key: string; label: string }

function ConstraintEditor({ initial, onSave, onCancel, isNew }: { initial: Constraint; onSave: (c: Constraint) => void; onCancel: () => void; isNew?: boolean }) {
  const [c, setC] = useState<Constraint>(initial);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const isEnum = ENUM_FIELDS.includes(c.field);

  useEffect(() => {
    if (c.field === "years" || c.field === "open_to_work") return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api<Option[]>(`/api/vocab?field=${c.field}&q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then(setOptions).catch(() => {});
    }, isEnum ? 0 : 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [c.field, q, isEnum]);

  const values = useMemo(() => c.values.map((v, i) => ({ key: v, label: c.labels[i] ?? v })), [c.values, c.labels]);
  const has = (k: string) => c.values.includes(k);
  const add = (o: Option) => !has(o.key) && setC({ ...c, values: [...c.values, o.key], labels: [...c.labels, o.label] });
  const remove = (k: string) => {
    const i = c.values.indexOf(k);
    setC({ ...c, values: c.values.filter((_, j) => j !== i), labels: c.labels.filter((_, j) => j !== i) });
  };
  const valid = c.field === "open_to_work" ? true : c.field === "years" ? c.min !== undefined || c.max !== undefined : c.values.length > 0;

  function save() {
    if (!valid) return;
    if (c.field === "open_to_work") onSave({ ...c, labels: ["Open to work"] });
    else if (c.field === "years") {
      const label = c.min !== undefined && c.max !== undefined ? `${c.min}–${c.max} years` : c.min !== undefined ? `${c.min}+ years` : `Up to ${c.max} years`;
      onSave({ ...c, labels: [label] });
    } else onSave(c);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4 text-sm"
    >
      <p className="font-medium">{FIELD_LABEL[c.field]}</p>

      <div role="radiogroup" aria-label="How this filter applies" className="grid grid-cols-3 gap-1 rounded-lg bg-paper p-1">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={c.mode === m}
            onClick={() => setC({ ...c, mode: m })}
            className={`rounded-md px-2 py-1.5 text-[13px] font-medium ${c.mode === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {SCOPED.includes(c.field) && (
        <div role="radiogroup" aria-label="Which roles count" className="flex gap-4">
          {(["any", "current"] as const).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="radio" name="scope" checked={(c.scope ?? "any") === s} onChange={() => setC({ ...c, scope: s })} className="accent-[var(--color-marker)]" />
              {s === "any" ? "Any role, past or present" : "Current role only"}
            </label>
          ))}
        </div>
      )}

      {c.field === "open_to_work" ? (
        <p className="text-muted">Candidates who marked themselves as open to new roles.</p>
      ) : c.field === "years" ? (
        <div className="flex items-center gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-muted">At least</span>
            <input type="number" min={0} max={60} className={input} value={c.min ?? ""} onChange={(e) => setC({ ...c, min: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-muted">At most</span>
            <input type="number" min={0} max={60} className={input} value={c.max ?? ""} onChange={(e) => setC({ ...c, max: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </label>
        </div>
      ) : isEnum ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={has(o.key)}
              onClick={() => (has(o.key) ? remove(o.key) : add(o))}
              className={`rounded-full border px-2.5 py-1 ${has(o.key) ? "border-marker bg-marker-soft text-marker" : "border-line-strong text-ink hover:bg-paper"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <div>
          {values.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {values.map((v) => (
                <li key={v.key} className="inline-flex items-center gap-1 rounded-full bg-marker-soft py-0.5 pl-2.5 pr-1 text-marker">
                  {v.label}
                  <button type="button" onClick={() => remove(v.key)} aria-label={`Remove ${v.label}`} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-marker/10">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            className={input}
            placeholder={values.length ? "Add another (any of these)" : `Type a ${FIELD_LABEL[c.field].toLowerCase()}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) {
                e.preventDefault();
                const exact = options.find((o) => o.label.toLowerCase() === q.trim().toLowerCase());
                add(exact ?? options[0] ?? { key: q.trim(), label: q.trim() });
                setQ("");
              }
            }}
            aria-label={`Search ${FIELD_LABEL[c.field].toLowerCase()} values`}
          />
          {options.filter((o) => !has(o.key)).length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line">
              {options.filter((o) => !has(o.key)).slice(0, 8).map((o) => (
                <li key={o.key}>
                  <button type="button" onClick={() => { add(o); setQ(""); }} className="w-full px-3 py-1.5 text-left hover:bg-paper">
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={btn.ghost} onClick={onCancel}>
          {isNew ? "Back" : "Cancel"}
        </button>
        <button type="submit" className={`${btn.primary} h-9`} disabled={!valid}>
          {isNew ? "Add filter" : "Apply"}
        </button>
      </div>
    </form>
  );
}
