-- A search with nothing usable to search on (no required filter: a hostile, empty or
-- exclusion-only brief) used to be cancelled. Its search_id then 404'd on page 1, though
-- POST /api/search had returned it. It is now kept as 'done' with no results, exactly
-- like an unsupported search: pageable (page 1 is an empty list), and still not counted
-- toward the free plan.

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

  if r ->> 'reason' in ('no_required', 'unsupported', 'too_broad') then
    -- Nothing we could apply: kept (so it pages and the filters can be fixed) but not counted.
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