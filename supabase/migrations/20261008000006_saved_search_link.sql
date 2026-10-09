-- A saved search remembers the search it came from, so running it again can use
-- the same rule as editing filters: free when it only shows people that search
-- already found, a new search when new people appear.

alter table public.saved_briefs
  add column if not exists search_id uuid references public.searches (id) on delete set null;

-- The linked search must belong to the same company.
drop policy if exists "own company insert" on public.saved_briefs;
create policy "own company insert" on public.saved_briefs
  for insert to authenticated with check (
    company_id = (select private.current_company_id())
    and (search_id is null or exists (
      select 1 from public.searches s
      where s.id = search_id and s.company_id = (select private.current_company_id()))));

drop policy if exists "own company update" on public.saved_briefs;
create policy "own company update" on public.saved_briefs
  for update to authenticated
  using (company_id = (select private.current_company_id()))
  with check (
    company_id = (select private.current_company_id())
    and (search_id is null or exists (
      select 1 from public.searches s
      where s.id = search_id and s.company_id = (select private.current_company_id()))));
