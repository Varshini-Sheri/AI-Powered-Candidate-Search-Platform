// Shapes the browser receives from the API.

export type Field =
  | "role" | "title" | "seniority" | "years" | "skill" | "location"
  | "company" | "company_trait" | "education_level" | "school" | "field_of_study" | "open_to_work";
export type Mode = "required" | "preferred" | "excluded";

export interface Constraint {
  id: string;
  field: Field;
  mode: Mode;
  scope?: "current" | "any";
  values: string[];
  labels: string[];
  min?: number;
  max?: number;
}

export interface Unsupported {
  text: string;
  mode: Mode;
}

export interface Filters {
  constraints: Constraint[];
  unsupported: Unsupported[];
}

export interface Card {
  id: string;
  name: string;
  headline: string | null;
  avatar_url: string | null;
  location: string | null;
  years_experience: number | null;
  current_title: string | null;
  current_company: string | null;
  current_company_logo: string | null;
  open_to_work?: boolean | null;
  skills: string[];
}

export interface SearchResult {
  search_id: string;
  brief?: string;
  filters: Filters;
  total: number;
  results: Card[];
  searches_remaining?: number | null;
  plan?: "free" | "paid";
  reason?: string | null;
  counted?: boolean;
}

export interface Plan {
  plan: "free" | "paid";
  searches_remaining: number | null;
}

export interface Shortlist {
  id: string;
  name: string;
  count: number;
  person_ids: string[];
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
}

export interface Education {
  school: string | null;
  degree: string | null;
  field: string | null;
  start: string | null;
  end: string | null;
}

export interface Profile {
  id: string;
  name: string;
  headline: string | null;
  avatar_url: string | null;
  location: string | null;
  years_experience: number | null;
  open_to_work?: boolean | null;
  skills: string[];
  experience: Experience[];
  education: Education[];
  shortlist_ids: string[];
}

export interface SavedBrief {
  id: string;
  brief: string;
  filters: Partial<Filters>;
  search_id: string | null;
  /** The linked search's result count, when there is one. */
  searches?: { total: number } | null;
  created_at: string;
}
