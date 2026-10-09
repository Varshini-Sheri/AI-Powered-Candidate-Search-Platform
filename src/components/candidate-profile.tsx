"use client";
import { GraduationCap, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { skillKey } from "@/lib/normalize";
import type { Profile } from "@/lib/types";
import { ApiError, api } from "./api";
import { ShortlistButton } from "./shortlist-button";
import { Avatar, Logo, Notice, btn, years } from "./ui";

function period(start: string | null, end: string | null, current: boolean): string {
  const fmt = (s: string | null) => {
    if (!s) return null;
    const t = Date.parse(s.length === 7 ? `${s}-01` : s);
    if (Number.isNaN(t)) return s;
    return new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const a = fmt(start);
  const b = current ? "Present" : fmt(end);
  return [a, b].filter(Boolean).join(" to ");
}

export function useProfile(id: string) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setProfile(null);
    setError(null);
    api<Profile>(`/api/people/${encodeURIComponent(id)}`)
      .then(setProfile)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this profile."));
  }, [id, attempt]);
  return { profile, error, retry: () => setAttempt((a) => a + 1) };
}

export function CandidateProfile({ id, highlight = [] }: { id: string; highlight?: string[] }) {
  const { profile: p, error, retry } = useProfile(id);
  const hl = new Set(highlight.map(skillKey));

  if (error) {
    return <Notice tone="stop" title="This profile didn't load" action={<button className={btn.secondary} onClick={retry}>Try again</button>}>{error}</Notice>;
  }
  if (!p) {
    return (
      <div aria-busy className="space-y-4 py-2">
        <div className="flex items-center gap-4">
          <span className="skeleton h-16 w-16 rounded-full" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-5 w-48 rounded" />
            <span className="skeleton block h-3.5 w-64 max-w-full rounded" />
          </span>
        </div>
        <span className="skeleton block h-24 rounded-xl" />
        <span className="skeleton block h-24 rounded-xl" />
      </div>
    );
  }

  const skills = [...p.skills].sort((a, b) => Number(hl.has(skillKey(b))) - Number(hl.has(skillKey(a))));

  return (
    <article className="space-y-8 pb-4">
      <header className="flex flex-wrap items-start gap-4">
        <Avatar src={p.avatar_url} name={p.name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
          {p.headline && <p className="mt-1 text-[15px] text-ink/85">{p.headline}</p>}
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {p.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} /> {p.location}
              </span>
            )}
            {years(p.years_experience) && <span>{years(p.years_experience)} experience</span>}
            {p.open_to_work && <span className="font-medium text-ok">Open to work</span>}
          </p>
        </div>
        <ShortlistButton personId={p.id} name={p.name} />
      </header>

      {skills.length > 0 && (
        <section aria-labelledby="skills-h">
          <h2 id="skills-h" className="mb-3 text-[15px] font-semibold">Skills</h2>
          <ul className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <li key={s} className={`rounded-md px-2 py-1 text-sm ${hl.has(skillKey(s)) ? "bg-marker-soft font-medium text-marker" : "bg-black/[.045] text-ink/80"}`}>
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="exp-h">
        <h2 id="exp-h" className="mb-3 text-[15px] font-semibold">Experience</h2>
        {p.experience.length === 0 ? (
          <p className="text-sm text-muted">No work history listed.</p>
        ) : (
          <ol className="relative space-y-5 border-l border-line pl-5">
            {p.experience.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${e.is_current ? "bg-marker" : "bg-line-strong"}`} />
                <p className="font-medium">{e.title ?? "Role not listed"}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink/85">
                  <Logo src={e.company_logo_url} />
                  {e.company}
                </p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {period(e.start, e.end, e.is_current)}
                  {e.location ? `, ${e.location}` : ""}
                </p>
                {e.description && <p className="mt-1.5 text-sm leading-relaxed text-ink/80">{e.description}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="edu-h">
        <h2 id="edu-h" className="mb-3 text-[15px] font-semibold">Education</h2>
        {p.education.length === 0 ? (
          <p className="text-sm text-muted">No education listed.</p>
        ) : (
          <ul className="space-y-3">
            {p.education.map((e, i) => (
              <li key={i} className="flex gap-3">
                <GraduationCap size={18} className="mt-0.5 shrink-0 text-faint" />
                <div>
                  <p className="font-medium">{e.school ?? "School not listed"}</p>
                  <p className="text-sm text-muted">{[e.degree, e.field].filter(Boolean).join(", ")}{e.end ? `, ${e.end}` : ""}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
