-- Customer ownership is server-controlled and kept separate by Stripe mode.
create table public.billing_customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  livemode boolean not null,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  primary key (user_id, livemode)
);
alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon, authenticated;
grant all on public.billing_customers to service_role;

alter table public.billing_checkout_intents alter column payment_link_id drop not null;
alter table public.billing_checkout_intents add column livemode boolean not null default true;
alter table public.billing_checkout_intents add column stripe_customer_id text;
alter table public.billing_checkout_intents add column price_id text;
alter table public.billing_checkout_intents add column checkout_session_id text unique;
alter table public.billing_checkout_intents add column expires_at timestamptz;
alter table public.billing_checkout_intents add column closed_at timestamptz;
create unique index billing_one_open_checkout
on public.billing_checkout_intents(user_id, livemode, plan)
where payment_link_id is null and closed_at is null;

alter table public.billing_subscriptions add column livemode boolean not null default true;

create or replace function public.sync_billing_subscription(intent_id uuid, snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.billing_checkout_intents;
begin
  select * into i from public.billing_checkout_intents where id=intent_id for update;
  if not found then raise exception 'Unknown checkout reference'; end if;
  if i.livemode <> coalesce((snapshot->>'livemode')::boolean,true) then
    raise exception 'Stripe mode mismatch';
  end if;
  if i.stripe_customer_id is not null and i.stripe_customer_id <> snapshot->>'customer' then
    raise exception 'Stripe customer mismatch';
  end if;
  if i.payment_link_id is null and i.subscription_id is not null and i.subscription_id <> snapshot->>'id' then
    raise exception 'Checkout already bound';
  end if;
  update public.billing_checkout_intents set subscription_id=snapshot->>'id',closed_at=now()
    where id=intent_id and subscription_id is null;
  insert into public.billing_subscriptions as existing
    (stripe_subscription_id,user_id,stripe_customer_id,plan,status,amount,currency,current_period_end,cancel_at_period_end,observed_at,livemode)
  values (snapshot->>'id',i.user_id,snapshot->>'customer',i.plan,snapshot->>'status',
    (snapshot->>'amount')::integer,snapshot->>'currency',(snapshot->>'period_end')::timestamptz,
    (snapshot->>'cancel_at_period_end')::boolean,(snapshot->>'observed_at')::timestamptz,i.livemode)
  on conflict (stripe_subscription_id) do update set
    status=excluded.status, amount=excluded.amount, currency=excluded.currency,
    current_period_end=excluded.current_period_end, cancel_at_period_end=excluded.cancel_at_period_end,
    observed_at=excluded.observed_at,updated_at=now()
  where existing.user_id=excluded.user_id and existing.livemode=excluded.livemode
    and existing.observed_at < excluded.observed_at;
end;
$$;
revoke all on function public.sync_billing_subscription(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sync_billing_subscription(uuid,jsonb) to service_role;
