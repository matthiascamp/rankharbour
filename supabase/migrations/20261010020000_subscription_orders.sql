create table public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  livemode boolean not null,
  kind text not null check (kind in ('seo','backlinks')),
  plan text not null,
  backlinks boolean not null default false,
  stripe_customer_id text not null,
  payment_method_id text,
  items jsonb not null,
  amount integer not null check (amount>0),
  state text not null default 'quoted' check (state in ('quoted','processing','pending','complete','closed')),
  subscription_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '15 minutes'),
  confirmed_at timestamptz
);
alter table public.billing_orders enable row level security;
revoke all on public.billing_orders from anon, authenticated;
grant all on public.billing_orders to service_role;
-- All tabs and retries share one subscription slot until it is canceled.
create unique index billing_order_subscription_slot
on public.billing_orders(user_id,livemode,kind)
where state in ('processing','pending','complete');
alter table public.billing_subscriptions add column addons text[] not null default '{}';

create function public.claim_billing_order(order_id uuid, owner_id uuid, mode boolean, card_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_orders;
begin
  select * into o from public.billing_orders where id=order_id for update;
  if not found or o.user_id<>owner_id or o.livemode<>mode then raise exception 'Unknown order'; end if;
  if o.state='closed' then raise exception 'Order closed'; end if;
  if o.confirmed_at is not null then return to_jsonb(o); end if;
  perform pg_advisory_xact_lock(hashtextextended(o.user_id::text || o.livemode::text,0));
  if exists(select 1 from public.billing_orders other where other.user_id=o.user_id
    and other.livemode=o.livemode and other.id<>o.id and other.state in ('processing','pending','complete')
    and (other.kind=o.kind or (o.backlinks and other.kind='backlinks') or (o.kind='backlinks' and other.backlinks))) then
    raise exception 'Another subscription is already pending or active';
  end if;
  if exists(select 1 from public.billing_subscriptions s where s.user_id=o.user_id and s.livemode=o.livemode
    and s.status not in ('canceled','incomplete_expired') and
    ((o.kind='seo' and s.plan not in ('backlinks','google-business-posts')) or
     ((o.kind='backlinks' or o.backlinks) and (s.plan='backlinks' or 'backlinks'=any(s.addons))))) then
    raise exception 'Subscription already exists';
  end if;
  if o.expires_at<now() then raise exception 'Quote expired'; end if;
  update public.billing_orders set confirmed_at=now(),payment_method_id=card_id,state='processing'
    where id=order_id returning * into o;
  return to_jsonb(o);
end;
$$;
revoke all on function public.claim_billing_order(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_billing_order(uuid,uuid,boolean,text) to service_role;

create function public.sync_direct_subscription(order_id uuid, snapshot jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare o public.billing_orders;
begin
  select * into o from public.billing_orders where id=order_id for update;
  if not found or o.confirmed_at is null then raise exception 'Order was not confirmed'; end if;
  if o.livemode<>(snapshot->>'livemode')::boolean or o.stripe_customer_id<>snapshot->>'customer'
    or (o.subscription_id is not null and o.subscription_id<>snapshot->>'id') then raise exception 'Subscription binding mismatch'; end if;
  update public.billing_orders set subscription_id=snapshot->>'id',state=case
    when snapshot->>'status' in ('canceled','incomplete_expired') then 'closed'
    when snapshot->>'status'='incomplete' then 'pending' else 'complete' end where id=order_id;
  insert into public.billing_subscriptions as existing
    (stripe_subscription_id,user_id,stripe_customer_id,plan,status,amount,currency,current_period_end,cancel_at_period_end,observed_at,livemode,addons)
  values(snapshot->>'id',o.user_id,o.stripe_customer_id,o.plan,snapshot->>'status',o.amount,'aud',
    (snapshot->>'period_end')::timestamptz,(snapshot->>'cancel_at_period_end')::boolean,
    (snapshot->>'observed_at')::timestamptz,o.livemode,case when o.backlinks then array['backlinks'] else array[]::text[] end)
  on conflict(stripe_subscription_id) do update set status=excluded.status,amount=excluded.amount,
    current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,
    observed_at=excluded.observed_at,updated_at=now(),addons=excluded.addons
  where existing.user_id=excluded.user_id and existing.livemode=excluded.livemode
    and existing.observed_at<excluded.observed_at;
end;
$$;
revoke all on function public.sync_direct_subscription(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sync_direct_subscription(uuid,jsonb) to service_role;
