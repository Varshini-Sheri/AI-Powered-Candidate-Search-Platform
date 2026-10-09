-- A search that returns nobody because we couldn't apply part of it (an unsupported
-- filter, or a request too broad to answer) doesn't use up the free search. It is kept
-- as 'done' so the recruiter can fix the filters from it; that fix is then charged like
-- a new search. An understood search with zero matches still counts.

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

  if r ->> 'reason' in ('unsupported', 'too_broad') then
    -- We couldn't apply it: kept so the filters can be fixed, but not counted.
    update public.searches
       set status = 'done', filters = p_filters, result_ids = '{}', total = 0,
           counts_toward_quota = false
     where id = s.id;
    return jsonb_build_object('search_id', s.id, 'total', 0, 'reason', r ->> 'reason',
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
