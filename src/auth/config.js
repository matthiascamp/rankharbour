const DEFAULT_URL = 'https://gczopudgxfciatvtxhll.supabase.co';
// Supabase publishable keys are designed to be included in browser bundles.
// Security is enforced by grants and RLS, not by hiding this value.
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_FEmC6glyIu92uhTjih7J5g_SJPi79pz';

/**
 * Reads public browser configuration. The publishable key is intentionally safe
 * to ship; authorization still comes from Supabase RLS policies.
 */
export function getAuthConfig(overrides = {}) {
  const runtime = globalThis.__APP_CONFIG__ ?? {};
  const url = overrides.url ?? runtime.supabaseUrl ?? DEFAULT_URL;
  const publishableKey =
    overrides.publishableKey ?? runtime.supabasePublishableKey ?? DEFAULT_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error(
      'Missing Supabase publishable key. Set window.__APP_CONFIG__.supabasePublishableKey before bootstrapping auth.',
    );
  }

  return { url, publishableKey };
}

