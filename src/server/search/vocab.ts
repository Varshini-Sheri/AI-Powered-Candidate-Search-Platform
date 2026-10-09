import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EDUCATION_LABELS,
  EDUCATION_LEVELS,
  ROLE_FAMILIES,
  ROLE_LABELS,
  SENIORITY,
  SENIORITY_LABELS,
  companyKey,
  compactKey,
  placeTerms,
  roleFamiliesFromTitle,
  similarity,
  simpleKey,
  skillKey,
  titleBase,
  usStateName,
} from "@/lib/normalize";
import type { Constraint, Filters, FiltersInput, LooseConstraint, Unsupported } from "./schema";
import { FUZZY, SENIORITY_EXPANSION } from "./tuning";

export type Kind = "skill" | "title" | "location" | "company" | "trait" | "school" | "field_of_study";
export interface VocabEntry { key: string; label: string; count: number }
export type Vocab = Record<Kind, Map<string, VocabEntry>>;

let cache: { at: number; vocab: Vocab } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** The vocabulary that exists in the data, loaded once and cached in memory. */
export async function loadVocab(db: SupabaseClient): Promise<Vocab> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.vocab;
  const vocab: Vocab = {
    skill: new Map(), title: new Map(), location: new Map(), company: new Map(),
    trait: new Map(), school: new Map(), field_of_study: new Map(),
  };
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from("vocab").select("kind,key,label,count")
      .order("kind").order("key").range(from, from + page - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      const m = vocab[r.kind as Kind];
      if (m) m.set(r.key, { key: r.key, label: r.label, count: r.count });
    }
    if (!data || data.length < page) break;
  }
  cache = { at: Date.now(), vocab };
  return vocab;
}

/** Regions recruiters name that the data stores as cities. Only cities present in the data are used. */
const REGIONS: Record<string, string[]> = {
  "bay area": ["San Francisco", "Oakland", "San Jose", "Palo Alto", "Mountain View", "Sunnyvale", "Berkeley", "Menlo Park", "Redwood City", "Santa Clara", "Cupertino"],
  "sf bay area": ["San Francisco", "Oakland", "San Jose", "Palo Alto", "Mountain View", "Sunnyvale", "Berkeley", "Menlo Park", "Redwood City", "Santa Clara", "Cupertino"],
  "silicon valley": ["San Jose", "Palo Alto", "Mountain View", "Sunnyvale", "Menlo Park", "Redwood City", "Santa Clara", "Cupertino"],
};

/** Named groups of schools. Only schools present in the data are used. */
const SCHOOL_GROUPS: Record<string, string[]> = {
  "ivy league": ["Harvard University", "Yale University", "Princeton University", "Columbia University", "University of Pennsylvania", "Brown University", "Dartmouth College", "Cornell University"],
  ivy: ["Harvard University", "Yale University", "Princeton University", "Columbia University", "University of Pennsylvania", "Brown University", "Dartmouth College", "Cornell University"],
};

const FIELD_ALIASES: Record<string, string> = {
  "cs": "computer science",
  "comp sci": "computer science",
  "ee": "electrical engineering",
  "ece": "electrical and computer engineering",
  "math": "mathematics",
  "stats": "statistics",
};

const CONNECTORS = new Set(["of", "the", "at", "in", "and", "for"]);
const NAME_FILLER = new Set([...CONNECTORS, "university", "college", "institute", "school"]);

/** "Carnegie Mellon University" -> "cmu", "New York University" -> "nyu". */
const initials = (key: string) => key.split(" ").filter((w) => w && !CONNECTORS.has(w)).map((w) => w[0]).join("");

/**
 * University-system prefixes written both ways: "UC Berkeley" / "University of
 * California, Berkeley", "UT Austin" / "University of Texas at Austin". The data
 * may use either form, so both are tried.
 */
const SYSTEM_PREFIXES: Array<[short: string, long: string]> = [
  ["uc", "university of california"],
  ["ut", "university of texas"],
  ["u", "university"], // "U of Michigan", "U Michigan"
];

/** Every way of writing the same name that should be looked up. The typed form comes first. */
function nameForms(key: string): string[] {
  const forms = new Set([key]);
  for (const [short, long] of SYSTEM_PREFIXES) {
    if (key.startsWith(`${short} `)) {
      const rest = key.slice(short.length + 1).replace(/^(at|of) /, "");
      forms.add(`${long} ${rest}`);
      forms.add(`${long} of ${rest}`);
      forms.add(`${long} at ${rest}`);
    }
    if (key.startsWith(`${long} `)) {
      forms.add(`${short} ${key.slice(long.length + 1).replace(/^(at|of) /, "")}`);
    }
  }
  return [...forms];
}

/** "tech" in a brief means "technology" in a name ("Georgia Tech"). */
const WORD_EQUIV: Record<string, string> = { tech: "technology" };
const hasWord = (ew: Set<string>, w: string) => ew.has(w) || (WORD_EQUIV[w] !== undefined && ew.has(WORD_EQUIV[w]));

/**
 * Names (companies, schools, fields of study), deterministic: exact, then every
 * distinctive word appears in the name ("Stanford" -> "Stanford University"),
 * then a unique acronym ("MIT"). Each step tries every written form of the name
 * (see nameForms) before moving on. Nothing found = [], never a guess.
 */
function matchName(map: Map<string, VocabEntry>, key: string, schoolForms = false): VocabEntry[] {
  const forms = schoolForms ? nameForms(key) : [key];
  for (const f of forms) {
    const exact = map.get(f);
    if (exact) return [exact];
  }
  const all = [...map.values()];

  for (const f of forms) {
    const words = f.split(" ").filter((w) => w && !NAME_FILLER.has(w));
    if (!words.length) continue;
    const named = all.filter((e) => {
      const ew = new Set(e.key.split(" "));
      return words.every((w) => hasWord(ew, w));
    });
    if (named.length) return named.length <= 5 ? named : []; // more than 5 = too vague
  }

  if (/^[a-z]{3,5}$/.test(key)) {
    const acronym = all.filter((e) => e.key.includes(" ") && initials(e.key) === key);
    if (acronym.length === 1) return acronym;
  }

  // The reverse: the data stores the abbreviation ("MIT") and the brief or model wrote
  // the full name ("Massachusetts Institute of Technology").
  for (const f of forms) {
    const words = f.split(" ").filter((w) => w && !CONNECTORS.has(w));
    if (words.length < 2) continue;
    const short = map.get(initials(f));
    if (short && /^[a-z]{2,5}$/.test(short.key)) return [short];
  }
  return [];
}

/** "product managers" -> "product manager". Used only when the typed form maps to nothing. */
function singular(text: string): string {
  return text
    .split(/(\s+)/)
    .map((w) => (/ies$/i.test(w) ? w.slice(0, -3) + "y" : /(ss|us|is)$/i.test(w) ? w : /s$/i.test(w) && w.length > 3 ? w.slice(0, -1) : w))
    .join("");
}

function fuzzy(map: Map<string, VocabEntry>, key: string, threshold: number, keyOf = (k: string) => k): VocabEntry | null {
  let best: VocabEntry | null = null;
  let score = threshold;
  const q = keyOf(key);
  for (const e of map.values()) {
    const s = similarity(q, keyOf(e.key));
    if (s > score || (s === score && best && e.count > best.count)) {
      score = s;
      best = e;
    }
  }
  return best;
}

/** Map one typed value onto entries that exist in the data. Empty = unmappable. */
function mapValue(field: LooseConstraint["field"], value: string, vocab: Vocab): VocabEntry[] {
  const v = value.trim();
  switch (field) {
    case "role": {
      const k = simpleKey(v).replace(/ /g, "_");
      if ((ROLE_FAMILIES as readonly string[]).includes(k)) return [{ key: k, label: ROLE_LABELS[k as keyof typeof ROLE_LABELS], count: 0 }];
      // Singular first: "product designers" must read as "product designer" (design), not "product".
      let fams = roleFamiliesFromTitle(singular(v));
      if (!fams.length) fams = roleFamiliesFromTitle(v);
      const specific = fams.filter((f) => f !== "software");
      return (specific.length ? specific : fams).map((f) => ({ key: f, label: ROLE_LABELS[f], count: 0 }));
    }
    case "seniority": {
      const k = simpleKey(v).replace(/ /g, "_");
      const base = (SENIORITY as readonly string[]).includes(k) ? k
        : /staff|principal|lead|distinguished/.test(k) ? "staff_plus"
        : /senior|sr/.test(k) ? "senior"
        : /junior|entry|jr|graduate/.test(k) ? "junior"
        : /mid/.test(k) ? "mid" : null;
      if (!base) return [];
      return (SENIORITY_EXPANSION[base] ?? [base]).map((s) => ({ key: s, label: SENIORITY_LABELS[s as keyof typeof SENIORITY_LABELS], count: 0 }));
    }
    case "education_level": {
      const k = simpleKey(v);
      const level = (EDUCATION_LEVELS as readonly string[]).includes(k) ? k
        : /phd|doctor/.test(k) ? "phd" : /\bmba\b/.test(k) ? "mba" : /\bm\.?s\.?c?\b|master of science/.test(k) ? "ms"
        : /master/.test(k) ? "masters" : /\bb\.?s\.?c?\b|bachelor of science/.test(k) ? "bs" : /\bb\.?a\b|bachelor of arts/.test(k) ? "ba"
        : /bachelor|undergrad/.test(k) ? "bachelors" : /associate/.test(k) ? "associate" : null;
      return level ? [{ key: level, label: EDUCATION_LABELS[level as keyof typeof EDUCATION_LABELS], count: 0 }] : [];
    }
    case "skill": {
      const k = skillKey(v);
      const hit = vocab.skill.get(k) ?? fuzzy(vocab.skill, k, FUZZY.skill, compactKey);
      return hit ? [hit] : [];
    }
    case "location": {
      const region = REGIONS[simpleKey(v).replace(/^(the|greater) /, "")];
      if (region) return region.flatMap((city) => mapValue("location", city, vocab));
      // A city wins over a state of the same name ("New York" = the city);
      // a state is used when no city matches ("California", "TX").
      const out: VocabEntry[] = [];
      const state = usStateName(v.replace(/\bstate\b/i, ""));
      const askedForState = /\bstate\b/i.test(v) || (state !== null && simpleKey(v).length === 2);
      for (const term of placeTerms(v)) {
        const city = askedForState ? undefined : vocab.location.get(term);
        const hit = city ?? (state ? vocab.location.get(`state:${state}`) : undefined) ?? fuzzy(vocab.location, term, FUZZY.location);
        if (hit) out.push(hit);
      }
      // "Seattle, WA" / "Austin, Texas" / "Boston, USA": retry with the city alone.
      const qualified = /^(.+?),\s*([^,]+)$/.exec(v);
      // Not for DC: "Washington, DC" is the city, never Washington state.
      const isDc = qualified ? /^d\.?\s*c\.?$/i.test(qualified[2].trim()) : false;
      if (!out.length && qualified && !isDc && (usStateName(qualified[2]) || /^(usa?|united states)$/i.test(qualified[2].trim()))) {
        return mapValue("location", qualified[1], vocab);
      }
      return out;
    }
    case "company":
      return matchName(vocab.company, companyKey(v));
    case "title": {
      const k = titleBase(v);
      const one = titleBase(singular(v)); // "Product Designers" -> "product designer"
      const hit = vocab.title.get(k) ?? vocab.title.get(one) ?? fuzzy(vocab.title, one, FUZZY.title) ?? fuzzy(vocab.title, k, FUZZY.title);
      return hit ? [hit] : [];
    }
    case "company_trait": {
      const hit = vocab.trait.get(simpleKey(v)) ?? vocab.trait.get(simpleKey(v).replace(/s$/, ""));
      return hit ? [hit] : [];
    }
    case "school": {
      const group = SCHOOL_GROUPS[simpleKey(v).replace(/^(the|an?) /, "").replace(/ (schools?|universities)$/, "")];
      if (group) return [...new Map(group.flatMap((n) => matchName(vocab.school, simpleKey(n), true)).map((e) => [e.key, e])).values()];
      return matchName(vocab.school, simpleKey(v), true);
    }
    case "field_of_study":
      return matchName(vocab.field_of_study, FIELD_ALIASES[simpleKey(v)] ?? simpleKey(v));
    default:
      return [];
  }
}

/** Model-suggested names for one value, used only when the value itself found nothing. Exact matches only. */
function variantHits(c: LooseConstraint, raw: string, vocab: Vocab): VocabEntry[] {
  if (c.field !== "company" && c.field !== "school" && c.field !== "field_of_study") return [];
  const names = c.variants?.find((v) => simpleKey(v.mention) === simpleKey(raw))?.names ?? [];
  const map = c.field === "company" ? vocab.company : c.field === "school" ? vocab.school : vocab.field_of_study;
  const keyOf = c.field === "company" ? companyKey : simpleKey;
  const hits = new Map<string, VocabEntry>();
  for (const n of names) {
    const e = map.get(keyOf(n));
    if (e) hits.set(e.key, e);
  }
  return [...hits.values()];
}

const NAME_FIELDS = new Set<string>(["company", "school", "field_of_study", "skill"]);

const FIELD_NOUN: Record<string, string> = {
  role: "role", title: "title", seniority: "seniority", skill: "skill", location: "location",
  company: "company", company_trait: "company type", education_level: "degree", school: "school",
  field_of_study: "field of study",
};

/**
 * Turns loose constraints (from the model or the UI) into constraints whose
 * values exist in the data. A value that cannot be mapped is never guessed: if
 * nothing in a constraint maps, the constraint becomes "unsupported" with its
 * mode, and Postgres returns nobody for unsupported required/excluded ones.
 */
export function mapFilters(input: FiltersInput, vocab: Vocab): Filters {
  const constraints: Constraint[] = [];
  const unsupported: Unsupported[] = [...input.unsupported];
  let n = 0;

  for (const c of input.constraints) {
    const id = `c${++n}`;
    if (c.field === "open_to_work") {
      // A flag in the data: no values to map.
      constraints.push({ id, field: "open_to_work", mode: c.mode, values: [], labels: ["Open to work"] });
      continue;
    }
    if (c.field === "years") {
      const min = c.min !== undefined && c.min > 0 ? c.min : undefined;
      const max = c.max;
      if (min === undefined && max === undefined) continue; // vacuous, e.g. "0+ years"
      if (min !== undefined && max !== undefined && min > max) continue;
      const label = min !== undefined && max !== undefined ? `${min}–${max} years`
        : min !== undefined ? `${min}+ years` : `Up to ${max} years`;
      constraints.push({ id, field: "years", mode: c.mode, values: [], labels: [label], min, max });
      continue;
    }

    const entries = new Map<string, VocabEntry>();
    const missed: string[] = [];
    for (const raw of c.values ?? []) {
      let hits = mapValue(c.field, raw, vocab);
      if (!hits.length) hits = variantHits(c, raw, vocab); // fallback only
      if (hits.length) for (const h of hits) entries.set(h.key, h);
      else missed.push(raw);
    }

    // A specific title the data does not have can still be expressed as a role.
    if (!entries.size && c.field === "title") {
      const roles = (c.values ?? []).flatMap((v) => mapValue("role", v, vocab));
      if (roles.length) {
        const keys = [...new Set(roles.map((r) => r.key))];
        constraints.push({ id, field: "role", mode: c.mode, scope: c.scope, values: keys, labels: keys.map((k) => ROLE_LABELS[k as keyof typeof ROLE_LABELS]) });
        continue;
      }
    }

    // Excluding a name nobody in the data has removes nobody: "not at Google" with no
    // Google employees means everyone qualifies. Keep it as a real exclusion (an editable
    // "Not: Google" chip) whose value matches no one, instead of an unsupported item,
    // which would return nobody. Only for names, and only after exact, word, acronym and
    // variant lookups have all failed, so a name the data spells differently still excludes.
    if (c.mode === "excluded" && NAME_FIELDS.has(c.field) && missed.length) {
      const keyOf = c.field === "company" ? companyKey : c.field === "skill" ? skillKey : simpleKey;
      for (const raw of missed) {
        const k = keyOf(raw);
        if (k) entries.set(k, { key: k, label: raw.trim(), count: 0 });
      }
      missed.length = 0;
    }

    if (!entries.size) {
      if (missed.length) unsupported.push({ text: `${FIELD_NOUN[c.field]}: ${missed.join(" or ")}`, mode: c.mode });
      continue;
    }
    const list = [...entries.values()];
    const scoped = ["role", "title", "company", "company_trait"].includes(c.field);
    constraints.push({
      id,
      field: c.field,
      mode: c.mode,
      ...(scoped ? { scope: c.scope ?? "any" } : {}),
      values: list.map((e) => e.key),
      labels: list.map((e) => e.label),
    });
  }

  // The model sometimes names one organization twice ("New York University" and "NYU").
  // Once both resolve to the same values they are the same constraint: keep one.
  const seen = new Set<string>();
  const unique = constraints.filter((c) => {
    const k = [c.field, c.mode, c.scope ?? "", [...c.values].sort().join("|"), c.min ?? "", c.max ?? ""].join("/");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { constraints: unique.slice(0, 15), unsupported: dedupe(unsupported).slice(0, 15) };
}

function dedupe(list: Unsupported[]): Unsupported[] {
  const seen = new Set<string>();
  return list.filter((u) => {
    const k = `${u.mode}:${u.text.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function topLabels(map: Map<string, VocabEntry>, n: number): string[] {
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n).map((e) => e.label);
}