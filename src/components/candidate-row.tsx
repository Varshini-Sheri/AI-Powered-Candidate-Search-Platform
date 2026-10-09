"use client";
import { MapPin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { skillKey } from "@/lib/normalize";
import type { Card } from "@/lib/types";
import { Avatar, Logo, years } from "./ui";

/** One person in a result list. The whole row opens the profile; actions sit on the right. */
export function CandidateRow({ c, highlight = [], action, href }: { c: Card; highlight?: string[]; action: ReactNode; href: string }) {
  const hl = new Set(highlight.map(skillKey));
  const isHl = (s: string) => hl.has(skillKey(s));
  const skills = [...c.skills].sort((a, b) => Number(isHl(b)) - Number(isHl(a))).slice(0, 5);
  const role = [c.current_title, c.current_company].filter(Boolean);
  return (
    <li className="group relative flex flex-wrap items-start gap-x-4 gap-y-3 rounded-[13px] border border-[#E5E7EB] bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(23,23,23,.03)] sm:flex-nowrap sm:px-5">
      <Avatar src={c.avatar_url} name={c.name} />
      <div className="min-w-0 flex-1">
        <Link href={href} scroll={false} className="font-medium text-ink after:absolute after:inset-0 hover:underline hover:underline-offset-2">
          {c.name}
        </Link>
        {role.length > 0 && (
          <p className="mt-1 flex items-center gap-2 text-sm text-ink/85">
            {c.current_company && <Logo src={c.current_company_logo} size={20} boxed />}
            <span className="truncate">{c.current_title}{c.current_title && c.current_company ? " at " : ""}{c.current_company}</span>
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {c.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} /> {c.location}
            </span>
          )}
          {years(c.years_experience) && <span>{years(c.years_experience)} experience</span>}
          {c.open_to_work && <span className="font-medium text-ok">Open to work</span>}
        </p>
        {skills.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Skills">
            {skills.map((s) => (
              <li key={s} className={`rounded-md px-1.5 py-0.5 text-xs ${isHl(s) ? "bg-marker-soft font-medium text-marker" : "bg-black/[.045] text-muted"}`}>
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative z-10 w-full pl-[60px] sm:w-auto sm:self-center sm:pl-0">{action}</div>
    </li>
  );
}
