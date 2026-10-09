-- Better "best matches first". Filters still decide who appears; this only
-- changes the order. Two signals that a requested skill is central to someone,
-- not just somewhere in their skill list:
--   headline_skill_keys: their skills named in their headline ("Senior Frontend Engineer · React, TypeScript")
--   current_skill_keys:  their skills named in their current job's description ("working mostly with React")
-- Both are filled by scripts/load-candidates.ts. Ties are still broken by id so paging is stable.

alter table public.candidates add column if not exists headline_skill_keys text[] not null default '{}';
alter table public.candidates add column if not exists current_skill_keys  text[] not null default '{}';

create or replace function private.compute(p_filters jsonb, p_weights jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cons       jsonb := coalesce(p_filters -> 'constraints', '[]'::jsonb);
  w_pref     numeric := coalesce((p_weights ->> 'preferred')::numeric, 3);
  w_current  numeric := coalesce((p_weights ->> 'current')::numeric, 2);
  w_headline numeric := coalesce((p_weights ->> 'skill_in_headline')::numeric, 1);
  w_job      numeric := coalesce((p_weights ->> 'skill_in_current_job')::numeric, 1);
  ids        text[];
  everyone   integer;
begin
  if jsonb_typeof(cons) <> 'array' then
    return jsonb_build_object('ids', '[]'::jsonb, 'reason', 'no_required');
  end if;

  -- Something required (or excluded) that the data cannot check: return nobody.
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
                -- a matched nice-to-have
                case when k.k ->> 'mode' = 'preferred' and private.match(c, k.k) then w_pref else 0 end
                -- a must-have role/title/company/trait that also holds in the current job
              + case when k.k ->> 'mode' = 'required'
                      and k.k ->> 'field' in ('role', 'title', 'company', 'company_trait')
                      and coalesce(k.k ->> 'scope', 'any') = 'any'
                      and private.match(c, k.k || '{"scope":"current"}'::jsonb)
                     then w_current else 0 end
                -- a requested skill named in their headline / used in their current job
              + case when k.k ->> 'field' = 'skill' and k.k ->> 'mode' <> 'excluded'
                      and c.headline_skill_keys && private.vals(k.k) then w_headline else 0 end
              + case when k.k ->> 'field' = 'skill' and k.k ->> 'mode' <> 'excluded'
                      and c.current_skill_keys && private.vals(k.k) then w_job else 0 end), 0)
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

revoke all on function private.compute(jsonb, jsonb) from public, anon, authenticated;
