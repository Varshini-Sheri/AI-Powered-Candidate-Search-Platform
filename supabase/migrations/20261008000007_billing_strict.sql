-- "A company is on the paid plan while its Stripe subscription is active":
-- only status 'active' counts as paid (trialing, past_due, incomplete, canceled are free).

create or replace function private.company_plan(p_company text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.subscriptions s
    where s.company_id = p_company and s.status = 'active'
  ) then 'paid' else 'free' end
$$;

revoke all on function private.company_plan(text) from public, anon, authenticated;
