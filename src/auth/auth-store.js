/**
 * Framework-neutral observable auth state. UI code subscribes to this store;
 * the store never creates or manipulates visual elements.
 */
export function createAuthStore(authService) {
  let state = Object.freeze({
    status: 'loading',
    session: null,
    user: null,
    profile: null,
    roles: [],
    error: null,
  });
  const listeners = new Set();
  let unsubscribeAuth;

  const emit = (next) => {
    state = Object.freeze({ ...state, ...next });
    listeners.forEach((listener) => listener(state));
  };

  const hydrate = async (session) => {
    if (!session?.user) {
      emit({ status: 'anonymous', session: null, user: null, profile: null, roles: [], error: null });
      return;
    }

    emit({ status: 'loading', session, user: session.user, error: null });
    try {
      const [profile, roles] = await Promise.all([
        authService.getProfile(session.user.id),
        authService.getRoles(session.user.id),
      ]);
      emit({ status: 'authenticated', profile, roles });
    } catch (error) {
      emit({ status: 'error', error });
    }
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    async start() {
      await hydrate(await authService.getSession());
      unsubscribeAuth = authService.onAuthStateChange(({ session }) => {
        void hydrate(session);
      });
    },

    stop() {
      unsubscribeAuth?.();
      unsubscribeAuth = undefined;
    },
  };
}

