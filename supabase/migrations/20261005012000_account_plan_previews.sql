-- Administrative previews never create Stripe customers, invoices or renewals.
create table public.account_plan_previews (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('starter','growth','pro','enterprise','enterprise-plus')),
  website text not null check (website ~ '^https://'),
  created_at timestamptz not null default now()
);
alter table public.account_plan_previews enable row level security;
revoke all on public.account_plan_previews from anon, authenticated;
grant select on public.account_plan_previews to authenticated;
grant all on public.account_plan_previews to service_role;
create policy "Read own plan preview" on public.account_plan_previews
for select to authenticated using ((select auth.uid()) = user_id);
