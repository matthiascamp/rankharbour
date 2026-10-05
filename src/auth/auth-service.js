import { getSupabaseClient } from './client.js';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export class AuthService {
  constructor(client = getSupabaseClient()) {
    this.client = client;
  }

  async getSession() {
    return unwrap(await this.client.auth.getSession()).session;
  }

  async getUser() {
    return unwrap(await this.client.auth.getUser()).user;
  }

  async signUp({ email, password, displayName, emailRedirectTo }) {
    return unwrap(
      await this.client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
          data: { display_name: displayName?.trim() || null },
        },
      }),
    );
  }

  async signInWithPassword({ email, password }) {
    return unwrap(await this.client.auth.signInWithPassword({ email, password }));
  }

  async signInWithOAuth(provider, redirectTo) {
    return unwrap(
      await this.client.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      }),
    );
  }

  async requestPasswordReset(email, redirectTo) {
    return unwrap(
      await this.client.auth.resetPasswordForEmail(email, { redirectTo }),
    );
  }

  async updatePassword(password) {
    return unwrap(await this.client.auth.updateUser({ password })).user;
  }

  async signOut({ scope = 'local' } = {}) {
    unwrap(await this.client.auth.signOut({ scope }));
  }

  async getProfile(userId) {
    const result = await this.client
      .from('profiles')
      .select('id, display_name, avatar_url, created_at, updated_at')
      .eq('id', userId)
      .single();
    return unwrap(result);
  }

  async updateProfile(userId, patch) {
    const allowed = {
      display_name: patch.displayName?.trim() || null,
      avatar_url: patch.avatarUrl?.trim() || null,
    };
    const result = await this.client
      .from('profiles')
      .update(allowed)
      .eq('id', userId)
      .select('id, display_name, avatar_url, created_at, updated_at')
      .single();
    return unwrap(result);
  }

  async getRoles(userId) {
    const result = await this.client
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    return unwrap(result).map(({ role }) => role);
  }

  onAuthStateChange(listener) {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      listener({ event, session });
    });
    return () => data.subscription.unsubscribe();
  }
}

