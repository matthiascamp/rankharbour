/**
 * Returns a navigation decision instead of performing one, keeping routing and
 * UI concerns outside the auth layer.
 */
export function authorizeRoute(authState, { requiresAuth = false, roles = [] } = {}) {
  if (authState.status === 'loading') return { allow: false, reason: 'loading' };
  if (authState.status === 'error') return { allow: false, reason: 'auth-error' };

  if (requiresAuth && authState.status !== 'authenticated') {
    return { allow: false, reason: 'sign-in-required', redirectTo: '/login' };
  }

  if (roles.length && !roles.some((role) => authState.roles.includes(role))) {
    return { allow: false, reason: 'forbidden', redirectTo: '/account' };
  }

  return { allow: true };
}

