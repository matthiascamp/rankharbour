# Supabase authentication architecture

This project is linked to Supabase project `gczopudgxfciatvtxhll`.

## SEO evaluation service

`supabase/functions/seo-evaluate` is deployed to this project. It accepts POST
`{ "url": "https://example.com" }` with the signed-in user's bearer token.
The handler verifies the token with Supabase Auth before any target request;
`verify_jwt = false` disables only the gateway's legacy JWT check.

The service resolves public addresses, connects to the validated IP with TLS
certificate verification for the original hostname, and revalidates redirects.
It rejects private/reserved addresses, credentials and nonstandard ports.
Requests have an 18-second network deadline, a 2 MB HTML limit, at most four
followed redirects, and a best-effort six-request-per-minute guard per user per
worker. The burst guard is not a distributed quota. The caller's token is never
sent to the target site. Scans do not create database records or modify websites.

Twelve equal-weight source-HTML checks produce a checklist score: pass = 1,
review = 0.5, issue = 0. This is not a ranking or Google performance score.
It does not render JavaScript, crawl other pages, check robots.txt or sitemaps,
or access traffic, rankings, backlinks, Search Console or Core Web Vitals.
The UI explains these limits and provides evidence and recommendations.

Tests: `npx deno test --node-modules-dir=auto supabase/functions/seo-evaluate/analyse_test.ts`.
Deploy only this service: `supabase functions deploy seo-evaluate --use-api`.
Live checks on 5 October 2026 returned actual results for Example.com and IANA;
unauthenticated requests returned 401 and a loopback URL was rejected.

Login sessions persist in the same browser and origin through the existing SDK
configuration (`persistSession` and `autoRefreshToken`). Different ports, hosts,
private browser windows or clearing site data do not share that stored session.

As of 5 October 2026, email confirmation is disabled at the user's request.
New email/password signups receive a session immediately. Password reset still
uses email. The account UI supports both settings if confirmation is enabled later.

## Boundaries

- `auth.users` (managed by Supabase) owns identities, credentials, email
  confirmation, password recovery, OAuth identities, tokens, and sessions.
- `public.profiles` stores presentation-only profile fields.
- `public.user_roles` stores authorization roles. New users receive `client`.
- `src/auth/auth-service.js` is the only module that calls Supabase Auth or the
  profile tables directly.
- `src/auth/auth-store.js` exposes framework-neutral state to any future UI.
- `src/auth/route-guard.js` makes route decisions without navigating or rendering.

`index.html` is intentionally untouched.

## Account page (`account.html`)

A single static page provides the whole user-facing flow, linked as "Log in"
from the desktop header and mobile menu of `RankHarbour.html`:

- email/password sign in, sign up (optional name, password confirmation),
  "check your email" feedback, forgot password, the recovery callback with a
  new-password form, and a signed-in view (name, email, sign out).
- `account.js` imports `AuthService` directly and is the only UI code; it does
  not use `auth-store.js` (no profile/role queries are needed for this page).
- The SDK is vendored at `vendor/supabase-js@2.117.2/supabase.mjs` (the
  package's browser build with ES exports appended, MIT licence alongside) and
  mapped to the bare `@supabase/supabase-js` specifier by an import map in
  `account.html`. The deployed page needs no `node_modules` or CDN. To upgrade,
  regenerate that file from `node_modules/@supabase/supabase-js/dist/umd/supabase.js`
  into a new versioned folder and update the import map.
- Forms are hidden and disabled until the SDK has loaded and use `method="post"`,
  so a JS failure can never submit a password in a URL. SDK load failures and
  timeouts show a visible "Sign-in is unavailable" state.
- The auth listener is registered immediately after the client is created and
  is synchronous (no awaited Supabase calls inside `onAuthStateChange`). A
  `type=recovery` link keeps the new-password screen until the password is
  updated. Callback error parameters (for example `otp_expired`) are mapped to a
  friendly message and stripped from the URL; tokens are never read or shown.
- Every email link redirects to `new URL('account.html', location.href)` — the
  exact same-origin page. No `next`/`redirect` parameter is ever followed.

`auth-ui-check.cjs` exercises these flows in Playwright with every Supabase
request mocked (no accounts created, no emails sent). Run
`python -m http.server 8765 --bind 127.0.0.1` in this folder, then
`node auth-ui-check.cjs` (screenshots go to `.review/`). Pages must be served
over HTTP(S); ES modules and import maps do not work from `file://`.

### Supabase dashboard setup for the account page

These are dashboard settings, not code, and have not been changed from here:

1. **Authentication → URL Configuration**
   - Site URL: the production origin, e.g. `https://YOUR-DOMAIN`.
   - Redirect URLs (exact entries, no wildcards needed):
     - `https://YOUR-DOMAIN/account.html`
     - `http://127.0.0.1:8765/account.html` (local testing, optional)
   If the host serves pages without the `.html` extension, the code still
   requests `/account.html`; make sure that path is served (not redirected
   with the hash dropped).
2. **Authentication → Providers → Email**: keep email/password enabled. With
   "Confirm email" on, sign-up shows the "check your inbox" screen; with it off,
   users are signed in immediately. Both paths are handled.
3. **Authentication → Emails / SMTP**: configure custom SMTP before launch. The
   built-in sender is heavily rate limited and only meant for testing. The
   default templates use `{{ .ConfirmationURL }}` and work as-is.
4. Minimum password length: the UI hints 6 characters (the Supabase default).
   If the project requires more, update `minlength` and the hint text in
   `account.html`; server errors are shown to the user either way.

Live email delivery (confirmation and reset emails actually arriving) has not
been tested and must be verified once on the deployed domain.

## Browser configuration

The project's **publishable** key is configured in `src/auth/config.js`. It is
designed to ship in browser code and is safe to publish when RLS and grants are
configured correctly. Never expose a secret key, service-role key, database
password, or personal access token.

Deployments may override the defaults before importing the auth modules:

```html
<script>
  window.__APP_CONFIG__ = {
    supabaseUrl: 'https://gczopudgxfciatvtxhll.supabase.co',
    supabasePublishableKey: 'sb_publishable_...'
  };
</script>
```

A bundler can instead translate `.env.local` values into the same runtime
object. `.env.example` documents the expected names.

## UI integration contract

```js
import { AuthService, createAuthStore } from './src/auth/index.js';

const auth = new AuthService();
const authStore = createAuthStore(auth);

const unsubscribe = authStore.subscribe((state) => {
  // Render loading, anonymous, authenticated, or error UI here.
});

await authStore.start();
```

Forms can call `signUp`, `signInWithPassword`, `signInWithOAuth`,
`requestPasswordReset`, `updatePassword`, or `signOut` on `AuthService`.

## Security model

- Tables revoke default browser privileges, then grant only required actions.
- RLS limits users to their own profile and role records.
- Role writes are not granted to browser clients, preventing self-promotion.
- Admin checks use a `SECURITY DEFINER` helper with an empty search path.
- Signup metadata can set display fields but can never set a role.
- Administrative work must use migrations, the Supabase dashboard, or a trusted
  backend holding a secret key. Secret keys must never enter browser code.

## Deployment checklist

1. Run `npm install`.
2. Apply migrations with `npm run supabase:push`.
3. Generate types with `npm run supabase:types` if TypeScript is introduced.
4. In Supabase Auth URL Configuration, set the production Site URL and exact
   allowed redirect URLs for signup confirmation, OAuth, and password recovery.
5. Configure custom SMTP for password recovery. Email confirmation is currently
   disabled by choice; enable it only when requested.
6. Add OAuth providers only after their callback URLs are registered.
7. Create the first admin explicitly from trusted SQL after that user signs up:

   ```sql
   insert into public.user_roles (user_id, role)
   values ('USER_UUID', 'admin')
   on conflict do nothing;
   ```

8. Review Supabase security and performance advisors after every schema change.

# Stripe subscriptions — October 2026

Plans bill in AUD every 28 days: Starter $99, Growth $149, Pro $249,
Enterprise $499, Enterprise Plus $799. Service inclusions retain their stated
monthly delivery schedule; billing uses a four-week cycle.

## Customer flow

1. Sign in, open Plans & Pricing and choose a plan.
2. The authenticated `billing` function validates the live Payment Link and price,
   checks for an existing subscription and creates a random reference tied to the
   Supabase user. Stripe opens in a new tab with this reference and prefilled email.
3. After checkout, return to Account centre. Status refreshes on window focus or
   with Refresh status. Browser state or a redirect never activates a subscription.
4. `stripe-webhook` verifies Stripe's signature, retrieves the current subscription,
   validates its plan and stores ownership, status, price, period end and cancellation.
5. Manage subscription opens Stripe's portal for a customer ID read from that user's
   trusted record. Customers can update payment details, view invoices and cancel at
   period end. Plan switching is not enabled in the portal configuration.

Purchases must start in the signed-in dashboard to carry an account reference.
Bare links shared elsewhere cannot automatically identify an account. Existing
purchases require an explicit administrative association; email alone is not proof
of ownership. Reused referenced links can create another purchase; all are associated
and displayed. The dashboard blocks checkout for known active/pending subscriptions,
but reusable Payment Links cannot prevent two simultaneous purchases.

## Deployed configuration

Project: `gczopudgxfciatvtxhll`.

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only Supabase secrets.
- `STRIPE_PORTAL_CONFIGURATION_ID`: `bpc_1UNBgNAn6lmj2fYVQCa5gCap`.
- Webhook URL: `https://gczopudgxfciatvtxhll.supabase.co/functions/v1/stripe-webhook`.
- Endpoint ID: `we_1UNBgGAn6lmj2fYVVF3cBFbK`.
- Snapshot and outgoing Stripe API version: `2025-02-24.acacia`.
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

The Edge gateway JWT check is disabled because each function authenticates requests
itself: `billing` validates the user through Supabase Auth; `stripe-webhook` verifies
HMAC on the raw body and rejects timestamps older than five minutes. The temporary
provisioning endpoint and token were removed. No Stripe secrets belong in this repo.

`billing_checkout_intents` is server-only. RLS permits users to read only their own
`billing_subscriptions`, with no browser writes. A service-role-only database function
updates snapshots atomically, ignores older snapshots and handles repeat deliveries.
Failed writes return an error so Stripe retries. Unrelated subscriptions without a
dashboard reference are ignored.

Use Stripe Workbench delivery logs to investigate failures and resend affected events.
Update the Supabase webhook secret when rotating the endpoint signing secret. Billing
records do not automatically perform the purchased SEO service.

## Validation

All five live Payment Links and account-reference handoffs were verified. A signed
webhook connection check returned 200; an unsigned request returned 400. Synthetic
database users verified ownership isolation, denied browser writes, stale/repeat
handling and reused-reference ownership, then were removed with their records.
Browser fixtures cover checkout, failure messages, status, portal navigation, mobile
layout and logout cleanup. Deno tests cover price validation and signature tampering
and expiry. No live purchase, renewal or paid cancellation was submitted.

