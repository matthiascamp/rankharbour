-- Reopening a Payment Link can produce another paid subscription.
-- Associate every confirmed purchase with the reference owner, never discard it.
create or replace function public.sync_billing_subscription(intent_id uuid, snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.billing_checkout_intents;
begin
  select * into i from public.billing_checkout_intents where id=intent_id for update;
  if not found then raise exception 'Unknown checkout reference'; end if;
  update public.billing_checkout_intents set subscription_id=snapshot->>'id' where id=intent_id and subscription_id is null;
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
