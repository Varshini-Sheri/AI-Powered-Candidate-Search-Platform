// Creates the two seeded recruiters through the Auth admin API and links each
// to its company. Safe to rerun: existing users get their password reset.
import { RECRUITERS, serviceClient } from "./lib/env";

const db = serviceClient();

async function ensureUser(email: string, password: string): Promise<string> {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error && created.data.user) return created.data.user.id;
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existing = data.users.find((u) => u.email === email);
  if (!existing) throw created.error ?? new Error(`Could not create ${email}`);
  const upd = await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
  if (upd.error) throw upd.error;
  return existing.id;
}

for (const [company, { email, password }] of Object.entries(RECRUITERS)) {
  const userId = await ensureUser(email, password);
  const { error } = await db.from("recruiters").upsert({ user_id: userId, company_id: company });
  if (error) throw error;
  console.log(`Recruiter ${email} -> ${company}`);
}
