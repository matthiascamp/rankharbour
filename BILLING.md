# Saved payment methods and subscriptions

Account centre provides **Save a payment method** before a customer subscribes.
The authenticated billing function creates a Stripe-hosted Checkout Session in
`setup` mode. The page asks permission to store the card for future purchases
and authorised recurring payments; saving a card takes no payment.

A server-only `billing_customers` record binds the signed-in Supabase user to
one Stripe customer per environment. Existing verified subscription customers
are reused. A customer is never discovered by email and the browser cannot
choose customer IDs, prices or ownership. A submitted saved payment method ID is verified against the account?s Stripe customer.

The account shows only card brand, last four digits and expiry. Full payment
details remain with Stripe. A verified `checkout.session.completed` setup event
checks the customer, account and successful SetupIntent before enabling card
reuse and setting an initial default card.

Plans & Pricing allows Backlinks to be selected before choosing a plan. The
embedded review lists each item, the exact AUD total every 28 days, the saved
card and explicit recurring-payment consent. No subscription is created until
**Confirm subscription & pay**. The server freezes validated prices into an
owned quote, verifies card ownership, atomically claims the subscription slot,
and creates one Stripe subscription with one or two items. A successful saved
card payment displays a receipt in RankHarbour. Only a verified paid invoice
and active subscription can produce a paid receipt. Bank verification or
failed payment offers the Stripe-hosted invoice, a status check and cancellation
of an incomplete subscription. Never promise that all cards can pay instantly.

Live prices come from the existing validated Payment Links with the exact AUD
price and 28-day interval. Old checkout/webhook references remain supported.
Older open hosted sessions are expired before a direct subscription is created.
Retries share the frozen order and Stripe idempotency key; active and pending
orders cannot be duplicated across tabs. Unresolved attempts older than the
Stripe idempotency window recover an existing subscription or require support;
they never create another payment. Order records and RPCs are service-only.
Subscription state is synced from authenticated Stripe API responses and
verified webhooks, never from browser claims. Mode separation also applies to
orders, prices, customers and subscriptions.

## Environments and deployment

The deployed functions use the existing Supabase `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and portal configuration. The key selects test/live
mode; ownership and subscription rows are separated by that mode. Never replace
the production secret with a local test key to run a sandbox check.

`APP_URL` optionally overrides the fixed return origin (default
`https://rankharbour.com.au`). The browser cannot provide a return URL.

Apply the migration, deploy the webhook, then deploy billing:

```sh
npx supabase db push
npx supabase functions deploy stripe-webhook
npx supabase functions deploy billing
```

The Stripe webhook endpoint must receive `checkout.session.completed`, existing
subscription events and invoice events. Setup and subscription checkout share
that event, so an endpoint already subscribed to it needs no additional event
type. A server using test credentials can resolve test prices with lookup keys
`rankharbour_<plan>_28d` and the same amount/currency/interval validation.

## Verification

```sh
npm run test:payments
npx deno test --allow-env --node-modules-dir=auto supabase/functions/_shared/customers_test.ts supabase/functions/_shared/orders_test.ts supabase/functions/stripe-webhook/billing_test.ts
```

Serve the project at `http://127.0.0.1:8765`, then run
`node saved-payments-ui-check.cjs` for mocked account, redirect, isolation and
responsive checks. Set `PLAYWRIGHT_MODULE` to your Playwright module if needed.

For the real Stripe sandbox check, set a test secret key in git-ignored
`.env.local`, start the same local server and run
`node scripts/test-saved-payments.mjs`. This refuses live keys, saves Stripe's
4242 test card in hosted Checkout, uses it for a direct Starter + Backlinks subscription and an idempotent retry, then
cancels the test subscription, removes the customer and archives test prices.
This check exercises Stripe's hosted flow; database/webhook ownership and
signature checks run separately in the automated tests above.
