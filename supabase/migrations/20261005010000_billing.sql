-- Only verified server-side Stripe events may write billing records.
create table public.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('starter','growth','pro','enterprise','enterprise-plus')),
  payment_link_id text not null,
  subscription_id text unique,
  created_at timestamptz not null default now()
);
create index billing_intents_user on public.billing_checkout_intents(user_id, created_at desc);
create table public.billing_subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  plan text not null,
  status text not null,
  amount integer not null,
  currency text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  observed_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index billing_subscriptions_user on public.billing_subscriptions(user_id);
alter table public.billing_checkout_intents enable row level security;
alter table public.billing_subscriptions enable row level security;
revoke all on public.billing_checkout_intents, public.billing_subscriptions from anon, authenticated;
grant select on public.billing_subscriptions to authenticated;
grant all on public.billing_checkout_intents, public.billing_subscriptions to service_role;
create policy "Read own subscriptions" on public.billing_subscriptions for select to authenticated using ((select auth.uid()) = user_id);

-- Atomically bind a reference once and ignore stale/concurrent deliveries.
create function public.sync_billing_subscription(intent_id uuid, snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.billing_checkout_intents;
begin
  select * into i from public.billing_checkout_intents where id=intent_id for update;
  if not found then raise exception 'Unknown checkout reference'; end if;
  if i.subscription_id is not null and i.subscription_id <> snapshot->>'id' then
    raise exception 'Checkout reference already used';
  end if;
  update public.billing_checkout_intents set subscription_id=snapshot->>'id' where id=intent_id;
  insert into public.billing_subscriptions as existing
    (stripe_subscription_id,user_id,stripe_customer_id,plan,status,amount,currency,current_period_end,cancel_at_period_end,observed_at)
  values (snapshot->>'id',i.user_id,snapshot->>'customer',i.plan,snapshot->>'status',
    (snapshot->>'amount')::integer,snapshot->>'currency',(snapshot->>'period_end')::timestamptz,
    (snapshot->>'cancel_at_period_end')::boolean,(snapshot->>'observed_at')::timestamptz)
  on conflict (stripe_subscription_id) do update set
    status=excluded.status, amount=excluded.amount, currency=excluded.currency,
    current_period_end=excluded.current_period_end, cancel_at_period_end=excluded.cancel_at_period_end,
    observed_at=excluded.observed_at,updated_at=now()
  where existing.user_id=excluded.user_id and existing.observed_at < excluded.observed_at;
end;
$$;
revoke all on function public.sync_billing_subscription(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sync_billing_subscription(uuid,jsonb) to service_role;
