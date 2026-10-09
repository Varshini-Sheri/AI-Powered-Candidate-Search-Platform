-- The free plan's "1 search in total" counts searches made on the free plan only.
-- Searches made while paid never use up the free allowance, so a company that
-- never used its free search still has it if its subscription ends. One used
-- before paying stays used.

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
  values (c, auth.uid(), p_brief, 'pending', private.company_plan(c) = 'free')
  returning searches.id into id;
  return id;
end;
$$;

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
  counted   boolean;
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
  counted := not narrowing and private.company_plan(c) = 'free';

  insert into public.searches (company_id, recruiter_id, parent_id, brief, filters, status,
                               counts_toward_quota, result_ids, total)
  values (c, auth.uid(), parent.id, parent.brief, p_filters, 'done',
          counted, ids, coalesce(array_length(ids, 1), 0))
  returning id into new_id;

  return jsonb_build_object(
    'search_id', new_id,
    'total', coalesce(array_length(ids, 1), 0),
    'reason', r ->> 'reason',
    'counted', counted,
    'results', private.page_cards(ids, 1));
end;
$$;

revoke all on function public.begin_search(text) from public, anon;
revoke all on function public.refine_search(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.begin_search(text) to authenticated;
grant execute on function public.refine_search(uuid, jsonb, jsonb) to authenticated;
