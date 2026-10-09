// Turns one raw record from candidates.json into the database row.
// The parser accepts several common field spellings because the exact shape is
// only known once the file is in hand; run `npm run data:inspect` to confirm
// which fields are used and adjust the lists below if a field is missed.

import {
  companyKey,
  educationLevel,
  locationTerms,
  roleFamiliesFromTitle,
  seniorityFromTitle,
  simpleKey,
  skillKey,
  titleBase,
  traitsFromExperience,
} from "./normalize";

type Raw = Record<string, unknown>;

function pick(o: Raw | undefined, keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const name = pick(v as Raw, ["name", "title", "label", "value"]);
    return typeof name === "string" ? name.trim() || null : null;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseDate(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v > 3000 ? v : Date.UTC(v, 0, 1);
  if (typeof v !== "string") return null;
  if (/present|current|now/i.test(v)) return null;
  const t = Date.parse(v.length === 7 ? `${v}-01` : v);
  return Number.isNaN(t) ? null : t;
}

export interface Experience {
  company: string | null;
  company_logo_url: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
  is_current: boolean;
  location: string | null;
  description: string | null;
  traits: string[];
}

export interface Education {
  school: string | null;
  degree: string | null;
  field: string | null;
  start: string | null;
  end: string | null;
}

export interface CandidateRow {
  id: string;
  name: string;
  headline: string | null;
  avatar_url: string | null;
  location: string | null;
  location_terms: string[];
  years_experience: number | null;
  skills: string[];
  skill_keys: string[];
  headline_skill_keys: string[];
  current_skill_keys: string[];
  current_title: string | null;
  current_title_base: string | null;
  title_bases: string[];
  role_families: string[];
  current_role_families: string[];
  seniority: string;
  current_company: string | null;
  current_company_key: string | null;
  current_company_logo: string | null;
  company_keys: string[];
  traits: string[];
  current_traits: string[];
  open_to_work: boolean | null;
  edu_levels: string[];
  school_keys: string[];
  field_keys: string[];
  profile: {
    id: string;
    name: string;
    headline: string | null;
    avatar_url: string | null;
    location: string | null;
    years_experience: number | null;
    open_to_work: boolean | null;
    skills: string[];
    experience: Experience[];
    education: Education[];
  };
}

function parseLocation(v: unknown): { label: string | null; parts: string[] } {
  if (typeof v === "string") {
    const parts = v.split(/[,/|]/).map((p) => p.trim()).filter(Boolean);
    return { label: v.trim() || null, parts };
  }
  if (v && typeof v === "object") {
    const o = v as Raw;
    const parts = [
      str(pick(o, ["city", "town"])),
      str(pick(o, ["state", "region", "province", "state_code"])),
      str(pick(o, ["country", "country_code", "country_name"])),
    ].filter((p): p is string => !!p);
    const label = str(pick(o, ["label", "display", "name", "full"])) ?? (parts.join(", ") || null);
    return { label, parts };
  }
  return { label: null, parts: [] };
}

function parseExperience(v: unknown): Experience {
  const e = (v ?? {}) as Raw;
  const companyRaw = pick(e, ["company", "company_name", "employer", "organization", "organisation"]);
  const companyObj = companyRaw && typeof companyRaw === "object" ? (companyRaw as Raw) : undefined;
  const endRaw = pick(e, ["end_year", "end_date", "end", "to", "endDate", "until"]);
  const currentFlag = pick(e, ["is_current", "current", "isCurrent"]);
  const startStr = str(pick(e, ["start_year", "start_date", "start", "from", "startDate", "since"]));
  const endStr = str(endRaw);
  return {
    company: str(companyRaw),
    company_logo_url:
      str(pick(e, ["company_logo_url", "logo_url", "logo", "companyLogoUrl"])) ??
      str(pick(companyObj, ["company_logo_url", "logo_url", "logo"])),
    title: str(pick(e, ["title", "role", "position", "job_title", "jobTitle"])),
    start: startStr,
    end: endStr && !/present|current|now/i.test(endStr) ? endStr : null,
    is_current: currentFlag === true || (currentFlag === undefined && (endRaw === undefined || endRaw === null || /present|current|now/i.test(String(endRaw)))),
    location: str(pick(e, ["location", "city"])),
    description: str(pick(e, ["description", "summary"])),
    traits: traitsFromExperience({ ...e, ...(companyObj ?? {}) }),
  };
}

function parseEducation(v: unknown): Education {
  const e = (v ?? {}) as Raw;
  return {
    school: str(pick(e, ["school", "institution", "university", "college", "school_name"])),
    degree: str(pick(e, ["degree", "degree_name", "qualification", "level"])),
    field: str(pick(e, ["field", "field_of_study", "major", "subject", "area"])),
    start: str(pick(e, ["start_date", "start", "from", "startDate"])),
    end: str(pick(e, ["end_date", "end", "to", "endDate", "graduation_year", "year"])),
  };
}

/** Which of a person's skills are named in a piece of text, matched as whole words ("Go" not in "Google"). */
export function skillsNamedIn(text: string | null | undefined, skillLabels: string[]): string[] {
  if (!text) return [];
  const t = ` ${text.toLowerCase()} `;
  const out = new Set<string>();
  for (const label of skillLabels) {
    const l = label.toLowerCase().trim();
    if (!l) continue;
    const escaped = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9+#])`).test(t)) out.add(skillKey(label));
  }
  return [...out];
}

export function candidateRow(raw: Raw): CandidateRow {
  const id = String(pick(raw, ["id", "candidate_id", "uuid"]));
  const name =
    str(pick(raw, ["name", "full_name", "fullName"])) ??
    [str(raw.first_name), str(raw.last_name)].filter(Boolean).join(" ") ??
    id;

  const experience = arr(pick(raw, ["work_history", "experience", "experiences", "work_experience", "jobs", "positions", "employment"]))
    .map(parseExperience)
    .sort((a, b) => (parseDate(b.start) ?? 0) - (parseDate(a.start) ?? 0));
  const education = arr(pick(raw, ["education", "educations", "schools"])).map(parseEducation);

  // Top-level current_* fields win; otherwise the open-ended (or newest) job.
  const topCompany = str(pick(raw, ["current_company", "company"]));
  const current =
    (topCompany && experience.find((e) => e.is_current && e.company === topCompany)) ||
    experience.find((e) => e.is_current) ||
    experience[0];

  const loc = parseLocation(pick(raw, ["location", "city", "based_in"]));
  const skillLabels = arr(pick(raw, ["skills", "skill_list", "technologies", "tech_stack"]))
    .map(str)
    .filter((s): s is string => !!s);

  let years = num(pick(raw, ["years_experience", "years_of_experience", "yearsOfExperience", "experience_years", "total_years", "years"]));
  if (years === null && experience.length) {
    const starts = experience.map((e) => parseDate(e.start)).filter((t): t is number => t !== null);
    if (starts.length) years = Math.round(((Date.now() - Math.min(...starts)) / 3.156e10) * 10) / 10;
  }

  const currentTitle = str(pick(raw, ["current_title", "title", "job_title"])) ?? current?.title ?? null;
  const currentCompany = topCompany ?? current?.company ?? null;
  const currentLogo = str(pick(raw, ["current_company_logo_url", "company_logo_url"])) ?? current?.company_logo_url ?? null;
  const headline = str(pick(raw, ["headline", "summary", "tagline"]));
  // `role` is the data's own job-function label (e.g. "DevOps Engineer"); treat it as a current title too.
  const roleLabel = str(pick(raw, ["role", "job_function"]));
  const titles = [...new Set([
    ...experience.map((e) => e.title).filter((t): t is string => !!t),
    ...(currentTitle ? [currentTitle] : []),
    ...(roleLabel ? [roleLabel] : []),
  ])];

  const roleFamilies = new Set<string>();
  for (const t of titles) for (const f of roleFamiliesFromTitle(t)) roleFamilies.add(f);
  const currentFamilies = [...new Set([...roleFamiliesFromTitle(currentTitle ?? headline), ...roleFamiliesFromTitle(roleLabel)])];
  for (const f of currentFamilies) roleFamilies.add(f);
  const openToWork = pick(raw, ["open_to_work", "openToWork", "is_open_to_work", "available"]);

  const traits = new Set<string>();
  for (const e of experience) for (const t of e.traits) traits.add(t);

  return {
    id,
    name: name || id,
    headline,
    avatar_url: str(pick(raw, ["avatar_url", "avatar", "photo_url", "image_url", "avatarUrl"])),
    location: loc.label,
    location_terms: locationTerms(loc.parts),
    years_experience: years,
    skills: skillLabels,
    skill_keys: [...new Set(skillLabels.map(skillKey).filter(Boolean))],
    headline_skill_keys: skillsNamedIn(headline, skillLabels),
    current_skill_keys: skillsNamedIn([current?.title, current?.description].filter(Boolean).join(". "), skillLabels),
    current_title: currentTitle,
    current_title_base: currentTitle ? titleBase(currentTitle) : null,
    title_bases: [...new Set(titles.map(titleBase))],
    role_families: [...roleFamilies],
    current_role_families: currentFamilies,
    // An explicit seniority field wins; otherwise it comes from the current title.
    seniority: seniorityFromTitle(str(pick(raw, ["seniority", "seniority_level", "level"])) ?? currentTitle ?? headline),
    current_company: currentCompany,
    current_company_key: currentCompany ? companyKey(currentCompany) : null,
    current_company_logo: currentLogo,
    company_keys: [...new Set(experience.map((e) => e.company).filter((c): c is string => !!c).map(companyKey))],
    traits: [...traits],
    current_traits: current?.traits ?? [],
    open_to_work: typeof openToWork === "boolean" ? openToWork : null,
    edu_levels: [...new Set(education.map((e) => educationLevel(e.degree)))],
    school_keys: [...new Set(education.map((e) => e.school).filter((s): s is string => !!s).map(simpleKey))],
    field_keys: [...new Set(education.map((e) => e.field).filter((s): s is string => !!s).map(simpleKey))],
    profile: {
      id,
      name: name || id,
      headline,
      avatar_url: str(pick(raw, ["avatar_url", "avatar", "photo_url", "image_url", "avatarUrl"])),
      location: loc.label,
      years_experience: years,
      open_to_work: typeof openToWork === "boolean" ? openToWork : null,
      skills: skillLabels,
      experience,
      education,
    },
  };
}

export function candidatesFromFile(json: unknown): Raw[] {
  if (Array.isArray(json)) return json as Raw[];
  if (json && typeof json === "object") {
    const o = json as Raw;
    for (const k of ["candidates", "data", "people", "items", "results"]) if (Array.isArray(o[k])) return o[k] as Raw[];
  }
  throw new Error("candidates.json: expected an array of candidates (or an object with a 'candidates' array)");
}
