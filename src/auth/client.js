import { createClient } from '@supabase/supabase-js';
import { getAuthConfig } from './config.js';

let browserClient;

export function getSupabaseClient(overrides) {
  if (!browserClient) {
    const { url, publishableKey } = getAuthConfig(overrides);
    browserClient = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}

