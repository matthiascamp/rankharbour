# Saved payment methods and subscriptions

Account centre provides **Save a payment method** before a customer subscribes.
The authenticated billing function creates a Stripe-hosted Checkout Session in
`setup` mode. The page asks permission to store the card for future purchases
and authorised recurring payments; saving a card takes no payment.

A server-only `billing_customers` record binds the signed-in Supabase user to
one Stripe customer per environment. Existing verified subscription customers
are reused. A customer is never discovered by email and the browser cannot
choose customer IDs, payment method IDs, prices or ownership.

The account shows only card brand, last four digits and expiry. Full payment
details remain with Stripe. A verified `checkout.session.completed` setup event
checks the customer, account and successful SetupIntent before enabling card
reuse and setting an initial default card. Subscription checkout passes the
same customer so Stripe can display the saved card for confirmation. Stripe
may require additional bank authentication.

New subscriptions use server-created Checkout Sessions. Live prices are taken
from the existing validated Payment Links, preserving the exact AUD price and
28-day interval. Old Payment Link webhook references remain supported. Pending
sessions are reused, Stripe session creation is idempotent, and a database
constraint prevents two open sessions for the same account, mode and plan.
Account subscriptions are only granted from verified Stripe events.

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
npx deno test --allow-env --node-modules-dir=auto supabase/functions/_shared/customers_test.ts supabase/functions/stripe-webhook/billing_test.ts
```

Serve the project at `http://127.0.0.1:8765`, then run
`node saved-payments-ui-check.cjs` for mocked account, redirect, isolation and
responsive checks. Set `PLAYWRIGHT_MODULE` to your Playwright module if needed.

For the real Stripe sandbox check, set a test secret key in git-ignored
`.env.local`, start the same local server and run
`node scripts/test-saved-payments.mjs`. This refuses live keys, saves Stripe's
4242 test card in hosted Checkout, uses it in subscription Checkout, then
cancels the test subscription, removes the customer and archives test prices.
This check exercises Stripe's hosted flow; database/webhook ownership and
signature checks run separately in the automated tests above.
