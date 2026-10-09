-- Tenancy: one helper resolves the caller's company; every policy uses it.
-- RLS is the wall for both doors into the database: our API (which queries with
-- the recruiter's token) and direct Supabase REST calls with that same token.

create or replace function private.current_company_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.company_id from public.recruiters r where r.user_id = auth.uid()
$$;

-- company_id is filled by the database, so the API never passes it and a
-- recruiter cannot stamp a row with another company.
alter table public.shortlists   alter column company_id set default private.current_company_id();
alter table public.saved_briefs alter column company_id set default private.current_company_id();

alter table public.companies        enable row level security;
alter table public.recruiters       enable row level security;
alter table public.candidates       enable row level security;
alter table public.vocab            enable row level security;
alter table public.searches         enable row level security;
alter table public.shortlists       enable row level security;
alter table public.shortlist_people enable row level security;
alter table public.saved_briefs     enable row level security;
alter table public.subscriptions    enable row level security;  -- no policies: service role only
alter table public.stripe_events    enable row level security;  -- no policies: service role only

create policy "own company" on public.companies
  for select to authenticated using (id = (select private.current_company_id()));

create policy "own row" on public.recruiters
  for select to authenticated using (user_id = (select auth.uid()));

create policy "shared read" on public.candidates
  for select to authenticated using (true);

create policy "shared read" on public.vocab
  for select to authenticated using (true);

-- Searches are written only by the SECURITY DEFINER search functions.
create policy "own company" on public.searches
  for select to authenticated using (company_id = (select private.current_company_id()));

create policy "own company read" on public.shortlists
  for select to authenticated using (company_id = (select private.current_company_id()));
create policy "own company insert" on public.shortlists
  for insert to authenticated with check (company_id = (select private.current_company_id()));
create policy "own company update" on public.shortlists
  for update to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));
create policy "own company delete" on public.shortlists
  for delete to authenticated using (company_id = (select private.current_company_id()));

-- Membership is checked through the parent list, so nobody can add to or read
-- another company's list even with a valid shortlist id.
create policy "via own list read" on public.shortlist_people
  for select to authenticated using (
    exists (select 1 from public.shortlists s
            where s.id = shortlist_id and s.company_id = (select private.current_company_id())));
create policy "via own list insert" on public.shortlist_people
  for insert to authenticated with check (
    exists (select 1 from public.shortlists s
            where s.id = shortlist_id and s.company_id = (select private.current_company_id())));
create policy "via own list delete" on public.shortlist_people
  for delete to authenticated using (
    exists (select 1 from public.shortlists s
            where s.id = shortlist_id and s.company_id = (select private.current_company_id())));

create policy "own company read" on public.saved_briefs
  for select to authenticated using (company_id = (select private.current_company_id()));
create policy "own company insert" on public.saved_briefs
  for insert to authenticated with check (company_id = (select private.current_company_id()));
create policy "own company update" on public.saved_briefs
  for update to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));
create policy "own company delete" on public.saved_briefs
  for delete to authenticated using (company_id = (select private.current_company_id()));
