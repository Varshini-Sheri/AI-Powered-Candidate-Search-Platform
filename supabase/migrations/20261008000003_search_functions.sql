-- Search, quota and paging. Every function that bypasses RLS (SECURITY DEFINER)
-- sets search_path = '', uses schema-qualified names, and reads the company from
-- the caller's token, never from an argument.
--
-- Filter shape (validated and mapped to real vocabulary by the server first):
-- {
--   "constraints": [ { "field": "skill", "mode": "required", "values": ["react"], "scope": "any" },
--                    { "field": "years", "mode": "required", "min": 5 } ],
--   "unsupported": [ { "text": "open to relocating", "mode": "preferred" } ]
-- }
-- mode: required -> must match, preferred -> ranking boost only, excluded -> must not match.

-- Plan and quota ------------------------------------------------------------------

create or replace function private.company_plan(p_company text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.subscriptions s
    where s.company_id = p_company and s.status in ('active', 'trialing')
  ) then 'paid' else 'free' end
$$;

-- A search counts when it finished, or while it is in flight (pending for under
-- 30 seconds). A pending row left behind by a crash stops counting on its own.
create or replace function private.searches_counted(p_company text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.searches s
  where s.company_id = p_company
    and s.counts_toward_quota
    and (s.status = 'done'
         or (s.status = 'pending' and s.created_at > now() - interval '30 seconds'))
$$;

create or replace function private.require_company()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare c text := private.current_company_id();
begin
  if c is null then raise exception 'not_a_recruiter'; end if;
  return c;
end;
$$;

-- Must be called with the company row already locked.
create or replace function private.assert_quota(p_company text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.company_plan(p_company) = 'free' and private.searches_counted(p_company) >= 1 then
    raise exception 'quota_exhausted';
  end if;
end;
$$;

create or replace function public.plan_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c text := private.require_company();
  p text := private.company_plan(c);
begin
  return jsonb_build_object(
    'plan', p,
    'searches_remaining',
    case when p = 'paid' then null
         else greatest(0, 1 - private.searches_counted(c)) end);
end;
$$;

-- Reserve a search. The row lock on the company makes concurrent requests line
-- up, so "count, then insert" cannot be raced: 50 parallel calls give 1 success.
create or replace function public.begin_search(p_brief text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c  text := private.require_company();
  id uuid;
begin
  if p_brief is null or char_length(p_brief) not between 1 and 500 then
    raise exception 'invalid_brief';
  end if;
  perform 1 from public.companies where companies.id = c for update;
  perform private.assert_quota(c);
  insert into public.searches (company_id, recruiter_id, brief, status, counts_toward_quota)
  values (c, auth.uid(), p_brief, 'pending', true)
  returning searches.id into id;
  return id;
end;
$$;

-- Release a reservation. Only pending rows (which have no results yet) can be
-- cancelled, so granting this to recruiters gives them nothing to exploit and
-- repeated calls are harmless.
create or replace function public.cancel_search(p_search_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.searches s
     set status = 'cancelled'
   where s.id = p_search_id
     and s.company_id = private.require_company()
     and s.status = 'pending'
$$;

-- Matching -------------------------------------------------------------------------

create or replace function private.vals(k jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(k -> 'values', '[]'::jsonb))), '{}')
$$;

create or replace function private.match(c public.candidates, k jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(case k ->> 'field'
    when 'role' then case when k ->> 'scope' = 'current'
                          then c.current_role_families && private.vals(k)
                          else c.role_families && private.vals(k) end
    when 'title' then case when k ->> 'scope' = 'current'
                           then c.current_title_base = any (private.vals(k))
                           else c.title_bases && private.vals(k) end
    when 'seniority' then c.seniority = any (private.vals(k))
    when 'years' then c.years_experience >= coalesce((k ->> 'min')::numeric, -1)
                  and c.years_experience <= coalesce((k ->> 'max')::numeric, 1000)
    when 'skill' then c.skill_keys && private.vals(k)
    when 'location' then c.location_terms && private.vals(k)
    when 'company' then case when k ->> 'scope' = 'current'
                             then c.current_company_key = any (private.vals(k))
                             else c.company_keys && private.vals(k) end
    when 'company_trait' then case when k ->> 'scope' = 'current'
                                   then c.current_traits && private.vals(k)
                                   else c.traits && private.vals(k) end
    when 'education_level' then c.edu_levels && private.vals(k)
    when 'school' then c.school_keys && private.vals(k)
    when 'field_of_study' then c.field_keys && private.vals(k)
    else false
  end, false)
$$;

-- Returns { "ids": [...ranked...], "reason": null | "unsupported" | "no_required" | "too_broad" }.
-- Required and excluded constraints decide who appears; the score only orders them.
create or replace function private.compute(p_filters jsonb, p_weights jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cons      jsonb := coalesce(p_filters -> 'constraints', '[]'::jsonb);
  w_pref    numeric := coalesce((p_weights ->> 'preferred')::numeric, 3);
  w_current numeric := coalesce((p_weights ->> 'current')::numeric, 2);
  ids       text[];
  everyone  integer;
begin
  if jsonb_typeof(cons) <> 'array' then
    return jsonb_build_object('ids', '[]'::jsonb, 'reason', 'no_required');
  end if;

  -- Something required (or excluded) that the data cannot check: we cannot
  -- promise anyone fits, so return nobody rather than the wrong people.
  if exists (select 1 from jsonb_array_elements(coalesce(p_filters -> 'unsupported', '[]'::jsonb)) u
             where u ->> 'mode' in ('required', 'excluded')) then
    return jsonb_build_object('ids', '[]'::jsonb, 'reason', 'unsupported');
  end if;

  -- No required constraint (a vague brief, or "anyone not at X"): never return everyone.
  if not exists (select 1 from jsonb_array_elements(cons) k where k ->> 'mode' = 'required') then
    return jsonb_build_object('ids', '[]'::jsonb, 'reason', 'no_required');
  end if;

  with k as (select value as k from jsonb_array_elements(cons)),
  matched as (
    select c.id,
      (select coalesce(sum(
                case when k.k ->> 'mode' = 'preferred' and private.match(c, k.k) then w_pref else 0 end
              + case when k.k ->> 'mode' = 'required'
                      and k.k ->> 'field' in ('role', 'title', 'company', 'company_trait')
                      and coalesce(k.k ->> 'scope', 'any') = 'any'
                      and private.match(c, k.k || '{"scope":"current"}'::jsonb)
                     then w_current else 0 end), 0)
         from k) as score
    from public.candidates c
    where not exists (select 1 from k where k.k ->> 'mode' = 'required' and not private.match(c, k.k))
      and not exists (select 1 from k where k.k ->> 'mode' = 'excluded' and private.match(c, k.k))
  )
  select coalesce(array_agg(id order by score desc, id), '{}') into ids from matched;

  select count(*) into everyone from public.candidates;
  if everyone > 0 and coalesce(array_length(ids, 1), 0) = everyone then
    return jsonb_build_object('ids', '[]'::jsonb, 'reason', 'too_broad');
  end if;

  return jsonb_build_object('ids', to_jsonb(ids), 'reason', null);
end;
$$;

-- Paging ------------------------------------------------------------------------------

-- Cards for one page, in rank order. The slice keeps the stored ranking because
-- positions come from WITH ORDINALITY, not from the join.
create or replace function private.page_cards(p_ids text[], p_page integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'name', c.name,
           'headline', c.headline,
           'avatar_url', c.avatar_url,
           'location', c.location,
           'years_experience', c.years_experience,
           'current_title', c.current_title,
           'current_company', c.current_company,
           'current_company_logo', c.current_company_logo,
           'skills', to_jsonb(c.skills[1:8])
         ) order by r.pos), '[]'::jsonb)
  from unnest(p_ids[((greatest(p_page, 1) - 1) * 20 + 1):(greatest(p_page, 1) * 20)])
       with ordinality as r(id, pos)
  join public.candidates c on c.id = r.id
$$;

create or replace function public.search_page(p_search_id uuid, p_page integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c text := private.require_company();
  s public.searches;
begin
  select * into s from public.searches
   where id = p_search_id and company_id = c and status = 'done';
  if not found then raise exception 'search_not_found'; end if;
  return jsonb_build_object(
    'search_id', s.id,
    'parent_id', s.parent_id,
    'brief', s.brief,
    'filters', s.filters,
    'total', s.total,
    'page', greatest(p_page, 1),
    'page_size', 20,
    'results', private.page_cards(s.result_ids, p_page));
end;
$$;

-- Running a reserved search ---------------------------------------------------------------

-- Only a recent pending reservation owned by the caller's company can be run, so
-- a finished search can never be re-run with different filters for free.
create or replace function public.run_search(p_search_id uuid, p_filters jsonb, p_weights jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   text := private.require_company();
  s   public.searches;
  r   jsonb;
  ids text[];
begin
  select * into s from public.searches
   where id = p_search_id and company_id = c for update;
  if not found then raise exception 'search_not_found'; end if;
  if s.status <> 'pending' then raise exception 'search_not_pending'; end if;
  if s.created_at < now() - interval '30 seconds' then raise exception 'reservation_expired'; end if;

  r := private.compute(p_filters, p_weights);
  ids := array(select jsonb_array_elements_text(r -> 'ids'));

  if r ->> 'reason' = 'no_required' then
    -- Nothing usable to search on: the reservation is released, not spent.
    update public.searches set status = 'cancelled', filters = p_filters where id = s.id;
    return jsonb_build_object('search_id', s.id, 'total', 0, 'reason', 'no_required',
                              'counted', false, 'results', '[]'::jsonb);
  end if;

  update public.searches
     set status = 'done', filters = p_filters, result_ids = ids,
         total = coalesce(array_length(ids, 1), 0)
   where id = s.id;

  return jsonb_build_object(
    'search_id', s.id,
    'total', coalesce(array_length(ids, 1), 0),
    'reason', r ->> 'reason',
    'counted', true,
    'results', private.page_cards(ids, 1));
end;
$$;

-- Correcting a search ------------------------------------------------------------------------

-- Free when every new result was already in the parent's results (a narrowing):
-- the company is only shown people it has already been shown. Anything else is a
-- broadening and reserves quota exactly like a new search.
create or replace function public.refine_search(p_parent_id uuid, p_filters jsonb, p_weights jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         text := private.require_company();
  parent    public.searches;
  r         jsonb;
  ids       text[];
  narrowing boolean;
  new_id    uuid;
begin
  perform 1 from public.companies where companies.id = c for update;

  select * into parent from public.searches
   where id = p_parent_id and company_id = c and status = 'done';
  if not found then raise exception 'search_not_found'; end if;

  r := private.compute(p_filters, p_weights);
  if r ->> 'reason' = 'no_required' then raise exception 'no_required'; end if;

  ids := array(select jsonb_array_elements_text(r -> 'ids'));
  narrowing := ids <@ parent.result_ids;

  if not narrowing then
    perform private.assert_quota(c);
  end if;

  insert into public.searches (company_id, recruiter_id, parent_id, brief, filters, status,
                               counts_toward_quota, result_ids, total)
  values (c, auth.uid(), parent.id, parent.brief, p_filters, 'done',
          not narrowing, ids, coalesce(array_length(ids, 1), 0))
  returning id into new_id;

  return jsonb_build_object(
    'search_id', new_id,
    'total', coalesce(array_length(ids, 1), 0),
    'reason', r ->> 'reason',
    'counted', not narrowing,
    'results', private.page_cards(ids, 1));
end;
$$;
