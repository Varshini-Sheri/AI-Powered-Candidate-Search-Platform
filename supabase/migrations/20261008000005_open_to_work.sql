-- The candidate data has an explicit open_to_work flag, so "open to work" briefs
-- become a real filter instead of an unsupported constraint.

alter table public.candidates add column if not exists open_to_work boolean;
create index if not exists candidates_open_to_work_idx on public.candidates (open_to_work);

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
    when 'open_to_work' then c.open_to_work is true
    else false
  end, false)
$$;

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
           'open_to_work', c.open_to_work,
           'skills', to_jsonb(c.skills[1:8])
         ) order by r.pos), '[]'::jsonb)
  from unnest(p_ids[((greatest(p_page, 1) - 1) * 20 + 1):(greatest(p_page, 1) * 20)])
       with ordinality as r(id, pos)
  join public.candidates c on c.id = r.id
$$;

revoke all on function private.match(public.candidates, jsonb) from public, anon, authenticated;
revoke all on function private.page_cards(text[], integer) from public, anon, authenticated;
