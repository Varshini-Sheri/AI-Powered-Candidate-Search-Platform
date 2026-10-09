-- Companies. Recruiters are created by scripts/seed-users.ts through the Auth admin API,
-- and candidates by scripts/load-candidates.ts.
insert into public.companies (id, name) values
  ('acme', 'Acme'),
  ('globex', 'Globex')
on conflict (id) do nothing;
