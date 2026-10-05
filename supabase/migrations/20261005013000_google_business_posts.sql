alter table public.billing_checkout_intents drop constraint billing_checkout_intents_plan_check;
alter table public.billing_checkout_intents add constraint billing_checkout_intents_plan_check
check (plan in ('starter','growth','pro','enterprise','enterprise-plus','google-business-posts'));
