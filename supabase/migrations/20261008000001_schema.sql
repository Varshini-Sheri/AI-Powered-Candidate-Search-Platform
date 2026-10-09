-- Schema: shared candidates, per-company data, searches (which double as quota
-- reservations) and billing state. Tenancy is enforced by RLS in the next migration.

create schema if not exists private;

-- Companies and recruiters -------------------------------------------------

create table public.companies (
  id   text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  name text not null
);

create table public.recruiters (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  company_id text not null references public.companies (id)
);

-- Candidates (shared by every company) --------------------------------------
-- Normalized, indexed columns are derived by scripts/load-candidates.ts so that
-- search is pure SQL. `profile` holds the display version of the full record.

create table public.candidates (
  id                    text primary key,
  name                  text not null,
  headline              text,
  avatar_url            text,
  location              text,
  location_terms        text[] not null default '{}',
  years_experience      numeric,
  skills                text[] not null default '{}',   -- display labels
  skill_keys            text[] not null default '{}',   -- normalized keys
  current_title         text,
  current_title_base    text,                           -- title without seniority words
  title_bases           text[] not null default '{}',   -- every title, without seniority words
  role_families         text[] not null default '{}',
  current_role_families text[] not null default '{}',
  seniority             text,
  current_company       text,
  current_company_key   text,
  current_company_logo  text,
  company_keys          text[] not null default '{}',
  traits                text[] not null default '{}',   -- explicit company traits, e.g. startup
  current_traits        text[] not null default '{}',
  edu_levels            text[] not null default '{}',
  school_keys           text[] not null default '{}',
  field_keys            text[] not null default '{}',
  profile               jsonb not null
);

create index candidates_skill_keys_idx     on public.candidates using gin (skill_keys);
create index candidates_role_families_idx  on public.candidates using gin (role_families);
create index candidates_title_bases_idx    on public.candidates using gin (title_bases);
create index candidates_company_keys_idx   on public.candidates using gin (company_keys);
create index candidates_location_terms_idx on public.candidates using gin (location_terms);
create index candidates_years_idx          on public.candidates (years_experience);
create index candidates_seniority_idx      on public.candidates (seniority);

-- Vocabulary actually present in the data. The server maps LLM output onto it,
-- so a filter can only use a value that exists.
create table public.vocab (
  kind  text not null,   -- skill, title, location, company, trait, school, field_of_study
  key   text not null,
  label text not null,
  count integer not null default 0,
  primary key (kind, key)
);

-- Searches = quota reservations -------------------------------------------------

create table public.searches (
  id                  uuid primary key default gen_random_uuid(),
  company_id          text not null references public.companies (id),
  recruiter_id        uuid references auth.users (id) on delete set null,
  parent_id           uuid references public.searches (id) on delete set null,
  brief               text not null,
  filters             jsonb,
  status              text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  counts_toward_quota boolean not null default true,
  result_ids          text[] not null default '{}',
  total               integer not null default 0,
  created_at          timestamptz not null default now()
);

create index searches_company_idx on public.searches (company_id, created_at desc);

-- Shortlists and saved searches -------------------------------------------------

create table public.shortlists (
  id         uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies (id),
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.shortlist_people (
  shortlist_id uuid not null references public.shortlists (id) on delete cascade,
  person_id    text not null references public.candidates (id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (shortlist_id, person_id)
);

create table public.saved_briefs (
  id         uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies (id),
  brief      text not null check (char_length(brief) between 1 and 500),
  filters    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index saved_briefs_company_idx on public.saved_briefs (company_id, created_at desc);

-- Billing (service role only) -------------------------------------------------

create table public.subscriptions (
  id                 text primary key,   -- Stripe subscription id
  company_id         text not null references public.companies (id),
  status             text not null,
  last_event_created bigint not null,
  last_event_id      text not null,
  updated_at         timestamptz not null default now()
);

create table public.stripe_events (
  event_id    text primary key,
  type        text not null,
  created     bigint,
  outcome     text,
  received_at timestamptz not null default now()
);
