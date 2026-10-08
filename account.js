/* ================================================================
   RankHarbour — account.js
   Simple email/password account page. All Supabase calls go through
   AuthService; this file only renders state and handles forms.
   ================================================================ */

import { initDashboard } from './dashboard.js';
import { initBilling } from './billing.js?v=20261006e';

window.__rhAuthBooted = true; // tells the inline watchdog in account.html that this module ran

const $ = (selector) => document.querySelector(selector);
const views = Array.from(document.querySelectorAll('[data-view]'));
const notice = $('#auth-notice');
const headerNav = $('#header-nav');
const dashboard = initDashboard($('[data-view="account"]'), headerNav.querySelector('[role="tablist"]'));
const billing = initBilling($('[data-view="account"]'));
const resetStatus = $('#dash-reset-status');
const headerLogout = $('#header-logout');
const logoutButtons = Array.from(document.querySelectorAll('[data-logout]'));

// Every email link returns here. Resolving a relative path drops any query/hash,
// so this is always the exact same-origin account.html URL.
const entryParams = new URLSearchParams(window.location.search);
const ACCOUNT_URL = new URL('account.html', window.location.href).href;
const LOAD_TIMEOUT_MS = 15000;

let auth = null;
let ready = false;
let busy = false;
let currentView = 'loading';
let currentUser = null;
let mode = null; // 'recovery' while the user is setting a new password
let shownUserId = null; // whose details the dashboard currently holds

// Read the callback URL before the SDK consumes it. Only the link type and the
// error code are inspected; tokens are never read, logged or rendered.
const callback = readCallback();

function readCallback() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const get = (key) => hash.get(key) ?? query.get(key);
  const errorCode = get('error_code') || get('error');
  const result = { recovery: get('type') === 'recovery', error: null };

  if (errorCode || get('error_description')) {
    result.error = errorCode === 'otp_expired'
      ? 'That email link has expired or has already been used. Please request a new one.'
      : 'That email link couldn’t be verified. Please request a new one.';
    result.recovery = false;
    cleanUrl(); // drop the error params so the SDK never processes them
  }
  return result;
}

function cleanUrl() {
  if (window.location.search || window.location.hash || window.location.href.endsWith('#')) {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
}

/* ── RENDERING ── */

function setNotice(message = '', tone = 'info') {
  notice.textContent = message;
  notice.dataset.tone = tone;
}

function show(view, { focus = true, keepNotice = false } = {}) {
  if (!keepNotice) setNotice('');
  views.forEach((section) => { section.hidden = section.dataset.view !== view; });
  currentView = view;
  document.body.dataset.authView = view; // the dashboard layout only applies to "account"
  headerNav.hidden = view !== 'account'; // header tabs belong to the signed-in dashboard only
  if (focus) document.querySelector(`[data-view="${view}"] .auth-title`)?.focus();
}

function setResetStatus(message = '', tone = 'success') {
  resetStatus.textContent = message;
  resetStatus.dataset.tone = tone;
}

function fillAccount(user) {
  billing.setUser(user.id);
  if (user.id !== shownUserId) {
    // A different person: start from a clean dashboard.
    dashboard.reset();
    setResetStatus('');
    shownUserId = user.id;
    if (['seo','pricing','editor'].includes(entryParams.get('tab'))) dashboard.open(entryParams.get('tab'));
    const website = entryParams.get('website');
    if (website) {
      try { const url = new URL(website); if (['http:','https:'].includes(url.protocol)) $('#seo-url').value = url.href; } catch { /* Keep the field empty for invalid links. */ }
    }
  }
  const name = (user.user_metadata?.display_name || '').trim();
  $('#account-title').textContent = name ? `Welcome, ${name}` : 'Welcome';
  $('#account-email').textContent = user.email || '';
  $('#account-name').textContent = name;
  $('#account-name-row').hidden = !name;
  $('#recovery-username').value = user.email || '';
}

// Signed out (or session lost): remove every personal value and reset the dashboard.
function clearAccount() {
  billing.setUser(null);
  shownUserId = null;
  $('#account-title').textContent = 'Welcome';
  $('#account-email').textContent = '';
  $('#account-name').textContent = '';
  $('#account-name-row').hidden = true;
  $('#recovery-username').value = '';
  setResetStatus('');
  dashboard.reset();
}

function render({ focus = true } = {}) {
  if (!currentUser) clearAccount();
  headerLogout.hidden = !currentUser; // only offered while a session exists

  if (mode === 'recovery') {
    if (currentUser) {
      fillAccount(currentUser);
      if (currentView !== 'recovery') show('recovery', { focus });
    } else {
      mode = null;
      show('forgot', { focus });
      setNotice('That reset link has expired or is invalid. Please request a new one.', 'error');
    }
    return;
  }

  if (currentUser) {
    fillAccount(currentUser);
    if (currentView !== 'account') show('account', { focus });
  } else if (['account', 'loading', 'recovery', 'unavailable'].includes(currentView)) {
    show('signin', { focus });
  }
}

/* ── AUTH EVENTS ──
   Kept synchronous: Supabase holds a lock while notifying listeners, so no
   Supabase calls are awaited in here. */

function handleAuthEvent({ event, session }) {
  if (event === 'PASSWORD_RECOVERY') mode = 'recovery';
  if (event === 'SIGNED_OUT') mode = null;
  currentUser = session?.user ?? null;

  if (event === 'INITIAL_SESSION' && !ready) {
    markReady();
    return;
  }
  if (ready) render();
}

function markReady() {
  ready = true;
  cleanUrl();
  document.querySelectorAll('.auth-form fieldset').forEach((fieldset) => { fieldset.disabled = false; });
  render({ focus: false });
  if (callback.error && mode !== 'recovery') {
    if (!currentUser) show('signin', { focus: false });
    setNotice(callback.error, 'error');
  }
}

/* ── ERRORS & VALIDATION ── */

function friendlyError(error) {
  const code = error?.code;
  const message = error?.message || '';
  if (error?.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'We couldn’t reach the sign-in service. Check your connection and try again.';
  }
  switch (code) {
    case 'invalid_credentials': return 'Incorrect email or password.';
    case 'email_not_confirmed': return 'Please confirm your email first — check your inbox for the confirmation link.';
    case 'user_already_exists': return 'An account with this email already exists. Try signing in instead.';
    case 'same_password': return 'Your new password must be different from your current one.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'Too many attempts. Please wait a minute and try again.';
    default: return message || 'Something went wrong. Please try again.';
  }
}

class FieldError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

function validate(form) {
  form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
  for (const input of form.querySelectorAll('input:not([hidden])')) {
    const { validity } = input;
    if (validity.valid) continue;
    if (validity.valueMissing) {
      const what = input.name === 'confirm' ? 'Please confirm your password.'
        : input.type === 'email' ? 'Please enter your email.' : 'Please enter a password.';
      throw new FieldError(what, input);
    }
    if (validity.typeMismatch) throw new FieldError('Please enter a valid email address.', input);
    if (validity.tooShort) throw new FieldError(`Password must be at least ${input.minLength} characters.`, input);
    throw new FieldError(input.validationMessage, input);
  }
  const confirm = form.elements.confirm;
  if (confirm && confirm.value !== form.elements.password.value) {
    throw new FieldError('Passwords don’t match.', confirm);
  }
}

/* ── FORMS ── */

function bindForm(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !ready) return;

    try {
      validate(form);
    } catch (error) {
      setNotice(error.message, 'error');
      error.field.setAttribute('aria-invalid', 'true');
      error.field.focus();
      return;
    }

    // Read values before disabling: disabled fields are excluded from FormData.
    const values = Object.fromEntries(new FormData(form));
    const fieldset = form.querySelector('fieldset');
    const button = form.querySelector('[type="submit"]');
    const viewBefore = currentView;

    busy = true;
    setNotice('');
    fieldset.disabled = true;
    button.textContent = button.dataset.busy;
    try {
      await handler(values, form);
    } catch (error) {
      setNotice(friendlyError(error), 'error');
    } finally {
      busy = false;
      fieldset.disabled = false;
      button.textContent = button.dataset.label;
      if (currentView === viewBefore && document.activeElement === document.body) button.focus();
    }
  });
}

bindForm($('#signin-form'), async ({ email, password }, form) => {
  await auth.signInWithPassword({ email: email.trim(), password });
  form.reset(); // SIGNED_IN event renders the account view
});

bindForm($('#signup-form'), async ({ displayName, email, password }, form) => {
  const data = await auth.signUp({
    email: email.trim(),
    password,
    displayName,
    emailRedirectTo: ACCOUNT_URL,
  });
  form.reset();
  if (!data.session) {
    $('#check-title').textContent = 'Confirm your email';
    $('#check-text').textContent =
      `We’ve sent a confirmation link to ${email.trim()}. Open it to activate your account, then sign in.`;
    show('check-email');
  }
});

bindForm($('#forgot-form'), async ({ email }, form) => {
  await auth.requestPasswordReset(email.trim(), ACCOUNT_URL);
  form.reset();
  $('#check-title').textContent = 'Check your email';
  $('#check-text').textContent =
    `If an account exists for ${email.trim()}, we’ve sent a link to reset your password. The link can only be used once.`;
  show('check-email');
});

bindForm($('#recovery-form'), async ({ password }, form) => {
  await auth.updatePassword(password);
  form.reset();
  mode = null;
  render();
  setNotice('Your password has been updated.', 'success');
});

// One logout for the header and the Account tab. Signing out only ever happens
// here, on an explicit click; navigation never ends the session.
function setLogoutBusy(isBusy) {
  logoutButtons.forEach((button) => {
    button.disabled = isBusy;
    button.textContent = isBusy ? button.dataset.busy : button.dataset.label;
  });
}

async function logOut() {
  if (busy || !ready || !currentUser) return;
  busy = true;
  dashboard.cancel(); // drop any in-flight evaluation before the session goes
  setLogoutBusy(true);
  try {
    await auth.signOut(); // SIGNED_OUT clears the dashboard and shows sign-in
    setNotice('You’ve been signed out.', 'success');
  } catch (error) {
    setNotice(friendlyError(error), 'error');
  } finally {
    busy = false;
    setLogoutBusy(false);
  }
}

logoutButtons.forEach((button) => button.addEventListener('click', logOut));

// Signed-in password reset: emails a recovery link to the account's own address.
$('#dash-reset-btn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (busy || !ready || !currentUser?.email) return;
  const { id, email } = currentUser;
  busy = true;
  button.disabled = true;
  button.textContent = button.dataset.busy;
  setResetStatus('');
  try {
    await auth.requestPasswordReset(email, ACCOUNT_URL);
    if (currentUser?.id === id) {
      setResetStatus(`We’ve sent a reset link to ${email}. The link can only be used once.`, 'success');
    }
  } catch (error) {
    if (currentUser?.id === id) setResetStatus(friendlyError(error), 'error');
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = button.dataset.label;
  }
});

/* ── VIEW SWITCHING ── */

document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => {
    if (busy) return;
    const target = button.dataset.go;
    const typedEmail = document.querySelector(`[data-view="${currentView}"] input[type="email"]:not([hidden])`)?.value;
    const targetEmail = document.querySelector(`[data-view="${target}"] input[type="email"]:not([hidden])`);
    if (typedEmail && targetEmail && !targetEmail.value) targetEmail.value = typedEmail;
    show(target);
  });
});

/* ── BOOT ── */

async function boot() {
  if (callback.recovery) mode = 'recovery';

  // Cover stalled module downloads as well as stalled session initialisation.
  setTimeout(() => {
    if (!ready) show('unavailable', { focus: false });
  }, LOAD_TIMEOUT_MS);

  try {
    const { AuthService } = await import('./src/auth/auth-service.js');
    auth = new AuthService();
  } catch (error) {
    console.error('RankHarbour auth failed to load', error);
    show('unavailable', { focus: false });
    return;
  }

  // Subscribe immediately after the client is created so PASSWORD_RECOVERY is
  // not missed; INITIAL_SESSION then drives the first render.
  auth.onAuthStateChange(handleAuthEvent);

}

boot();
