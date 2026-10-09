"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { CircleAlert, SearchX, TriangleAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-marker px-4 h-10 text-sm font-semibold text-marker-ink shadow-[0_1px_2px_rgba(23,23,23,.1),inset_0_1px_0_rgba(255,255,255,.14)] transition-colors hover:bg-[#6450e8] disabled:opacity-50 disabled:pointer-events-none",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 h-10 text-sm font-semibold text-ink shadow-[0_1px_2px_rgba(23,23,23,.04)] transition-colors hover:border-[#c9c6d6] hover:bg-[#fbfbfd] disabled:opacity-50 disabled:pointer-events-none",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-medium text-muted hover:text-ink hover:bg-black/[.04] disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-stop px-4 h-10 text-sm font-semibold text-white hover:bg-[#912a23] disabled:opacity-50",
};

export const input =
  "h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-faint focus:border-marker focus:outline-none focus:ring-[3px] focus:ring-marker/15";

export function Avatar({ src, name, size = 44 }: { src: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  if (!src || failed) {
    return (
      <span style={{ width: size, height: size, fontSize: size * 0.36 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-marker-soft font-medium text-marker">
        {initials}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size }} className="shrink-0 rounded-full bg-line object-cover" />;
}

export function Logo({ src, size = 16, boxed = false }: { src: string | null; size?: number; boxed?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size }} className="shrink-0 rounded-[4px] object-contain" />;
  if (!boxed) return img;
  // A soft rounded tile so logos of any shape read at a consistent size.
  return <span className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-[#E5E7EB] bg-[#FAFAFB]">{img}</span>;
}

/** A dialog that is a bottom sheet on phones and a centered panel or side drawer on larger screens. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = "center",
  hideTitle = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  side?: "center" | "right";
  hideTitle?: boolean;
}) {
  const desktop =
    side === "right"
      ? "md:inset-y-0 md:right-0 md:left-auto md:top-0 md:bottom-0 md:h-full md:max-h-none md:w-[560px] md:rounded-none md:anim-right"
      : "md:left-1/2 md:top-[12vh] md:bottom-auto md:w-[440px] md:-translate-x-1/2 md:rounded-3xl md:anim-fade";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[#171717]/35" />
        <Dialog.Content
          className={`anim-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl focus:outline-none ${desktop}`}
        >
          <div className={`flex items-start justify-between gap-4 px-5 pt-4 ${hideTitle ? "pb-0" : "pb-2"}`}>
            <div className={hideTitle ? "sr-only" : ""}>
              <Dialog.Title className="text-[17px] font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>}
            </div>
            {!description && <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            <Dialog.Close className={`${btn.ghost} -mr-2 ml-auto h-9 w-9 px-0`} aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 pb-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <ul aria-hidden className="divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 py-4">
          <span className="skeleton h-11 w-11 rounded-full" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3.5 w-40 rounded" />
            <span className="skeleton block h-3 w-64 max-w-full rounded" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Notice({ tone = "neutral", title, children, action }: { tone?: "neutral" | "amber" | "stop"; title: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    neutral: "card",
    amber: "rounded-2xl border border-[#f0d9a8] bg-amber-soft",
    stop: "rounded-2xl border border-[#f0c9c4] bg-stop-soft",
  };
  const icons = {
    neutral: { Icon: SearchX, cls: "bg-marker-soft text-marker" },
    amber: { Icon: TriangleAlert, cls: "bg-white/70 text-amber" },
    stop: { Icon: CircleAlert, cls: "bg-white/70 text-stop" },
  };
  const { Icon, cls } = icons[tone];
  return (
    <div role={tone === "stop" ? "alert" : "status"} className={`flex gap-4 p-5 sm:p-6 ${tones[tone]}`}>
      <span aria-hidden className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cls}`}>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <p className="text-[15px] font-semibold leading-snug text-ink">{title}</p>
        {children && <div className="mt-1.5 text-sm leading-relaxed text-muted">{children}</div>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function years(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  const r = Math.round(n);
  return `${r} ${r === 1 ? "year" : "years"}`;
}
