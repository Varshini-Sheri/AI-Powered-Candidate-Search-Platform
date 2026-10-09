-- Billing: one function records the event and applies it in a single transaction.
-- Called only by the webhook route, with the service-role key, after the route has
-- verified the Stripe signature.

create or replace function public.apply_stripe_event(p_event jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev_id   text   := p_event ->> 'id';
  ev_type text   := p_event ->> 'type';
  created bigint := nullif(p_event ->> 'created', '')::bigint;
  obj     jsonb  := p_event -> 'data' -> 'object';
  sub_id  text;
  company text;
  status  text;
begin
  if ev_id is null or ev_type is null then
    return 'ignored:malformed';
  end if;

  -- Idempotency: the first insert wins; a repeat changes nothing.
  insert into public.stripe_events (event_id, type, created)
  values (ev_id, ev_type, created)
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if ev_type not like 'customer.subscription.%' then
    update public.stripe_events set outcome = 'ignored:type' where event_id = ev_id;
    return 'ignored:type';
  end if;

  sub_id  := obj ->> 'id';
  company := obj -> 'metadata' ->> 'company';
  status  := case when ev_type = 'customer.subscription.deleted' then 'canceled'
                  else obj ->> 'status' end;

  if sub_id is null or status is null or created is null
     or not exists (select 1 from public.companies where id = company) then
    update public.stripe_events set outcome = 'ignored:subject' where event_id = ev_id;
    return 'ignored:subject';
  end if;

  -- Ordering: an event only applies if it is newer than the stored state.
  -- Ties on the same second: a cancellation wins, and a canceled subscription is
  -- never reactivated (Stripe never reactivates one). Other ties keep the stored
  -- state; see README for how this was checked against the sample events.
  insert into public.subscriptions as s (id, company_id, status, last_event_created, last_event_id)
  values (sub_id, company, status, created, ev_id)
  on conflict (id) do update
     set status = excluded.status,
         company_id = excluded.company_id,
         last_event_created = excluded.last_event_created,
         last_event_id = excluded.last_event_id,
         updated_at = now()
   where s.status <> 'canceled'
     and (excluded.last_event_created > s.last_event_created
          or (excluded.last_event_created = s.last_event_created and excluded.status = 'canceled'));

  if found then
    update public.stripe_events set outcome = 'applied' where event_id = ev_id;
    return 'applied';
  end if;
  update public.stripe_events set outcome = 'stale' where event_id = ev_id;
  return 'stale';
end;
$$;

-- Grants --------------------------------------------------------------------------------
-- Postgres grants EXECUTE on new functions to PUBLIC, and Supabase grants table
-- privileges to anon and authenticated by default. Lock everything down, then
-- grant back only what a recruiter needs.

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

revoke all on all functions in schema public  from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.current_company_id() to authenticated;  -- used by policies and defaults

grant execute on function public.plan_info()                        to authenticated;
grant execute on function public.begin_search(text)                 to authenticated;
grant execute on function public.cancel_search(uuid)                to authenticated;
grant execute on function public.run_search(uuid, jsonb, jsonb)     to authenticated;
grant execute on function public.refine_search(uuid, jsonb, jsonb)  to authenticated;
grant execute on function public.search_page(uuid, integer)         to authenticated;
grant execute on function public.apply_stripe_event(jsonb)          to service_role;

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.companies, public.recruiters, public.candidates, public.vocab, public.searches
  from authenticated;
revoke all on public.subscriptions, public.stripe_events from authenticated;
grant select on public.companies, public.recruiters, public.candidates, public.vocab, public.searches
  to authenticated;
grant select, insert, update, delete on public.shortlists, public.shortlist_people, public.saved_briefs
  to authenticated;
